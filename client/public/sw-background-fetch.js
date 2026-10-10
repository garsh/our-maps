// Background Fetch API Event Handlers for OurMaps Service Worker
const BG_FETCH_CHANNEL = 'offline-map-downloads';
const EXTRACT_DIR = 'offline-extracts';
const EXTRACT_CACHE_NAME = 'offline-extracts-cache';

function sanitizeMapId(mapId) {
  return (mapId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extractFileName(mapId) {
  return `${sanitizeMapId(mapId)}.pmtiles`;
}

function partFileName(mapId) {
  return `${sanitizeMapId(mapId)}.pmtiles.part`;
}

function metaFileName(mapId) {
  return `${sanitizeMapId(mapId)}.pmtiles.part.meta`;
}

async function getOfflineMapRecord(mapId) {
  if (typeof indexedDB === 'undefined' || !mapId) return null;
  try {
    const req = indexedDB.open('MapTilesDB_v2', 7);
    const db = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction('maps', 'readonly');
      const store = tx.objectStore('maps');
      const getReq = store.get(mapId);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => reject(getReq.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

async function markMapCompleteInIndexedDB(mapId, totalBytes) {
  if (typeof indexedDB === 'undefined' || !mapId) return;
  try {
    const req = indexedDB.open('MapTilesDB_v2', 7);
    const db = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('maps', 'readwrite');
      const store = tx.objectStore('maps');
      const getReq = store.get(mapId);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (record) {
          const total = record.totalTiles || 1;
          record.completedTiles = total;
          if (totalBytes > 0) record.extractTotalBytes = totalBytes;
          record.lastAccessedAt = Date.now();
          store.put(record);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[sw-bg-fetch] Error updating IndexedDB:', err);
  }
}

async function markMapPartialInIndexedDB(mapId, receivedBytes, expectedBytes) {
  if (typeof indexedDB === 'undefined' || !mapId || !expectedBytes || expectedBytes <= 0) return;
  try {
    const req = indexedDB.open('MapTilesDB_v2', 7);
    const db = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('maps', 'readwrite');
      const store = tx.objectStore('maps');
      const getReq = store.get(mapId);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (record && record.totalTiles) {
          const ratio = Math.min(1, Math.max(0, receivedBytes / expectedBytes));
          record.completedTiles = Math.round(ratio * record.totalTiles);
          record.extractTotalBytes = expectedBytes;
          record.lastAccessedAt = Date.now();
          store.put(record);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[sw-bg-fetch] Error updating partial IndexedDB:', err);
  }
}

async function notifyClients(message) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(BG_FETCH_CHANNEL);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // Ignore BroadcastChannel errors
  }

  try {
    if (self.clients && self.clients.matchAll) {
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        client.postMessage(message);
      }
    }
  } catch {
    // Ignore postMessage errors
  }
}

self.addEventListener('backgroundfetchsuccess', (event) => {
  event.waitUntil((async () => {
    const registration = event.registration;
    const mapId = registration.id.replace(/^map-/, '');
    console.log(`[sw-bg-fetch] backgroundfetchsuccess event fired for map ${mapId}`);

    const mapRecord = await getOfflineMapRecord(mapId);
    const mapName = mapRecord?.name || 'Map';

    const records = await registration.matchAll();
    let totalBytesWritten = 0;
    let expectedTotalBytes = registration.downloadTotal || mapRecord?.extractTotalBytes || 0;
    let isComplete = false;

    for (const record of records) {
      const response = await record.responseReady;
      if (!response || (!response.ok && response.status !== 206)) {
        console.error(`[sw-bg-fetch] Record response failed: status=${response?.status}`);
        continue;
      }

      const xBytes = Number(response.headers?.get('x-extract-bytes') || 0);
      if (xBytes > 0) expectedTotalBytes = xBytes;
      const contentRange = response.headers?.get('content-range');
      if (contentRange) {
        const match = /\/(\d+)$/.exec(contentRange);
        if (match) {
          const n = Number(match[1]);
          if (n > 0) expectedTotalBytes = n;
        }
      }
      if (!expectedTotalBytes && response.status === 200) {
        const cl = Number(response.headers?.get('content-length') || 0);
        if (cl > 0) expectedTotalBytes = cl;
      }

      let writtenViaOPFS = false;
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle(EXTRACT_DIR, { create: true });
          const partName = partFileName(mapId);
          const finalName = extractFileName(mapId);

          const partHandle = await dir.getFileHandle(partName, { create: true });
          if (typeof partHandle.createWritable === 'function') {
            const writable = await partHandle.createWritable();
            try {
              if (response.body && typeof response.body.pipeTo === 'function') {
                await response.body.pipeTo(writable);
              } else {
                const buffer = await response.arrayBuffer();
                await writable.write(buffer);
                await writable.close();
              }
            } catch (streamErr) {
              console.warn(`[sw-bg-fetch] Stream pipe interrupted for ${mapId}:`, streamErr);
            }

            const file = await partHandle.getFile();
            totalBytesWritten = file.size;
            writtenViaOPFS = true;

            // Only promote .part to .pmtiles if bytes match expected total!
            const full = expectedTotalBytes > 0
              ? totalBytesWritten >= expectedTotalBytes
              : totalBytesWritten > 127;

            if (full) {
              try { await dir.removeEntry(finalName); } catch {}
              let moved = false;
              if (typeof partHandle.move === 'function') {
                try {
                  await partHandle.move(finalName);
                  moved = true;
                } catch {
                  moved = false;
                }
              }
              if (!moved) {
                const dest = await dir.getFileHandle(finalName, { create: true });
                const destWritable = await dest.createWritable();
                if (typeof file.stream === 'function') {
                  await file.stream().pipeTo(destWritable);
                } else {
                  await destWritable.write(await file.arrayBuffer());
                  await destWritable.close();
                }
                try { await dir.removeEntry(partName); } catch {}
              }
              try { await dir.removeEntry(metaFileName(mapId)); } catch {}
              isComplete = true;
            }
          }
        } catch (opfsErr) {
          console.warn(`[sw-bg-fetch] OPFS write failed in Service Worker for ${mapId}:`, opfsErr);
        }
      }

      // If OPFS was not writable in Service Worker, stash in CacheStorage for window transfer
      if (!writtenViaOPFS && typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(EXTRACT_CACHE_NAME);
          await cache.put(record.request, response.clone());
        } catch (cacheErr) {
          console.warn(`[sw-bg-fetch] Failed to cache response in CacheStorage:`, cacheErr);
        }
      }
    }

    if (isComplete) {
      await markMapCompleteInIndexedDB(mapId, totalBytesWritten);
      try {
        if (typeof registration.updateUI === 'function') {
          await registration.updateUI({ title: `${mapName} downloaded` });
        }
      } catch {}
      await notifyClients({
        type: 'bg-fetch-success',
        mapId,
        totalBytes: totalBytesWritten,
      });
    } else {
      console.warn(`[sw-bg-fetch] Download for ${mapId} incomplete: written ${totalBytesWritten}/${expectedTotalBytes} bytes`);
      await markMapPartialInIndexedDB(mapId, totalBytesWritten, expectedTotalBytes);
      try {
        if (typeof registration.updateUI === 'function') {
          await registration.updateUI({ title: `${mapName} download paused` });
        }
      } catch {}
      await notifyClients({
        type: 'bg-fetch-partial',
        mapId,
        receivedBytes: totalBytesWritten,
        totalBytes: expectedTotalBytes,
      });
    }
  })());
});

self.addEventListener('backgroundfetchfail', (event) => {
  event.waitUntil((async () => {
    const registration = event.registration;
    const mapId = registration.id.replace(/^map-/, '');
    console.error(`[sw-bg-fetch] backgroundfetchfail fired for map ${mapId}, failureReason:`, registration?.failureReason);

    const mapRecord = await getOfflineMapRecord(mapId);
    const mapName = mapRecord?.name || 'Map';

    // IMPORTANT: DO NOT remove .part or .meta! Keep partial bytes on disk so the user can resume!

    try {
      if (typeof registration.updateUI === 'function') {
        await registration.updateUI({ title: `${mapName} download paused` });
      }
    } catch {}

    await notifyClients({
      type: 'bg-fetch-fail',
      mapId,
      error: 'Download paused',
    });
  })());
});

self.addEventListener('backgroundfetchabort', (event) => {
  event.waitUntil((async () => {
    const registration = event.registration;
    const mapId = registration.id.replace(/^map-/, '');
    console.warn(`[sw-bg-fetch] backgroundfetchabort fired for map ${mapId}`);

    await notifyClients({
      type: 'bg-fetch-abort',
      mapId,
    });
  })());
});

self.addEventListener('backgroundfetchclick', (event) => {
  event.waitUntil((async () => {
    const registration = event.registration;
    const mapId = registration.id.replace(/^map-/, '');
    console.log(`[sw-bg-fetch] backgroundfetchclick fired for map ${mapId}`);
    const urlToOpen = mapId ? `/map/${mapId}` : '/';

    if (self.clients && self.clients.matchAll) {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if ('focus' in client) {
          if (client.url && (client.url.includes(mapId) || client.url.endsWith('/'))) {
            return client.focus();
          }
        }
      }
      if (allClients.length > 0 && 'focus' in allClients[0]) {
        await allClients[0].focus();
        if ('navigate' in allClients[0]) {
          return allClients[0].navigate(urlToOpen);
        }
        return;
      }
    }
    if (self.clients && self.clients.openWindow) {
      return self.clients.openWindow(urlToOpen);
    }
  })());
});

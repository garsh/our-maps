// Background Fetch API Event Handlers for OurMaps Service Worker
const BG_FETCH_CHANNEL = 'offline-map-downloads';
const EXTRACT_DIR = 'offline-extracts';

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

async function markMapCompleteInIndexedDB(mapId, totalBytes) {
  if (typeof indexedDB === 'undefined') return;
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

async function notifyClients(message) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(BG_FETCH_CHANNEL);
      channel.postMessage(message);
      channel.close();
    }
  } catch (err) {
    // Ignore BroadcastChannel errors
  }

  try {
    if (self.clients && self.clients.matchAll) {
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        client.postMessage(message);
      }
    }
  } catch (err) {
    // Ignore postMessage errors
  }
}

self.addEventListener('backgroundfetchsuccess', (event) => {
  event.waitUntil((async () => {
    const registration = event.registration;
    const mapId = registration.id.replace(/^map-/, '');
    console.log(`[sw-bg-fetch] backgroundfetchsuccess event fired for map ${mapId}`);
    const records = await registration.matchAll();
    let totalBytesWritten = 0;

    for (const record of records) {
      const response = await record.responseReady;
      if (!response || (!response.ok && response.status !== 206)) {
        console.error(`[sw-bg-fetch] Record response failed: status=${response?.status}`);
        throw new Error(`Background fetch record failed with status ${response?.status}`);
      }

      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(EXTRACT_DIR, { create: true });
        const partName = partFileName(mapId);
        const finalName = extractFileName(mapId);

        try { await dir.removeEntry(partName); } catch (e) {}

        const partHandle = await dir.getFileHandle(partName, { create: true });
        const writable = await partHandle.createWritable();

        if (response.body && typeof response.body.pipeTo === 'function') {
          await response.body.pipeTo(writable);
        } else {
          const buffer = await response.arrayBuffer();
          await writable.write(buffer);
          await writable.close();
        }

        const file = await partHandle.getFile();
        totalBytesWritten = file.size;

        try { await dir.removeEntry(finalName); } catch (e) {}

        let moved = false;
        if (typeof partHandle.move === 'function') {
          try {
            await partHandle.move(finalName);
            moved = true;
          } catch (e) {
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
          try { await dir.removeEntry(partName); } catch (e) {}
        }
        try { await dir.removeEntry(metaFileName(mapId)); } catch (e) {}
      }
    }

    await markMapCompleteInIndexedDB(mapId, totalBytesWritten);

    try {
      if (typeof registration.updateUI === 'function') {
        await registration.updateUI({ title: 'Download Complete' });
      }
    } catch (e) {
      // updateUI can fail or not be supported in some environments
    }

    await notifyClients({
      type: 'bg-fetch-success',
      mapId,
      totalBytes: totalBytesWritten,
    });
  })());
});

self.addEventListener('backgroundfetchfail', (event) => {
  event.waitUntil((async () => {
    const registration = event.registration;
    const mapId = registration.id.replace(/^map-/, '');
    console.error(`[sw-bg-fetch] backgroundfetchfail fired for map ${mapId}, failureReason:`, registration?.failureReason);

    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(EXTRACT_DIR, { create: false });
        try { await dir.removeEntry(partFileName(mapId)); } catch (e) {}
        try { await dir.removeEntry(metaFileName(mapId)); } catch (e) {}
      }
    } catch (e) {}

    await notifyClients({
      type: 'bg-fetch-fail',
      mapId,
      error: 'Background fetch failed',
    });
  })());
});

self.addEventListener('backgroundfetchabort', (event) => {
  event.waitUntil((async () => {
    const registration = event.registration;
    const mapId = registration.id.replace(/^map-/, '');
    console.warn(`[sw-bg-fetch] backgroundfetchabort fired for map ${mapId}`);

    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(EXTRACT_DIR, { create: false });
        try { await dir.removeEntry(partFileName(mapId)); } catch (e) {}
        try { await dir.removeEntry(metaFileName(mapId)); } catch (e) {}
      }
    } catch (e) {}

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

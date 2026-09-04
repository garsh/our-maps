const EXTRACT_DIR = 'offline-extracts';
const extractCache = new Map<string, File | null>();
// Use a 128MB checkpoint interval (and minimum 60s time interval) to prevent OPFS createWritable/close commit thrashing on large gigabyte-sized files.
const DEFAULT_CHECKPOINT_BYTES = 128 * 1024 * 1024;
const MIN_CHECKPOINT_INTERVAL_MS = 60 * 1000;

function sanitizeMapId(mapId: string): string {
  return mapId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extractFileName(mapId: string): string {
  return `${sanitizeMapId(mapId)}.pmtiles`;
}

function partFileName(mapId: string): string {
  return `${sanitizeMapId(mapId)}.pmtiles.part`;
}

function metaFileName(mapId: string): string {
  return `${sanitizeMapId(mapId)}.pmtiles.part.meta`;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  const message = (err as { message?: string }).message || '';
  return name === 'NotFoundError' || /could not be found/i.test(message);
}

async function getExtractDirectory(create = false): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(EXTRACT_DIR, { create });
  } catch (err) {
    if (!create && isNotFoundError(err)) return null;
    throw err;
  }
}

export function invalidateExtractCache(mapId?: string): void {
  if (mapId) {
    extractCache.delete(mapId);
  } else {
    extractCache.clear();
  }
}

export async function extractExists(mapId: string): Promise<boolean> {
  const file = await getExtractFile(mapId);
  return file !== null;
}

async function readExtractHandle(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    if (file.size < 127) return null;
    return file;
  } catch {
    return null;
  }
}

export async function listExtractNames(): Promise<string[]> {
  try {
    const dir = await getExtractDirectory(false);
    if (!dir) return [];
    const names: string[] = [];
    const iterable = dir as FileSystemDirectoryHandle & {
      keys?: () => AsyncIterable<string>;
      entries?: () => AsyncIterable<[string, FileSystemHandle]>;
    };
    if (typeof iterable.keys === 'function') {
      for await (const name of iterable.keys()) names.push(name);
    } else if (typeof iterable.entries === 'function') {
      for await (const [name] of iterable.entries()) names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}

export async function getExtractFile(mapId: string): Promise<File | null> {
  if (!mapId) return null;
  if (extractCache.has(mapId)) return extractCache.get(mapId) ?? null;
  try {
    const dir = await getExtractDirectory(false);
    if (!dir) {
      extractCache.set(mapId, null);
      return null;
    }
    const file = await readExtractHandle(dir, extractFileName(mapId));
    extractCache.set(mapId, file);
    return file;
  } catch {
    return null;
  }
}

export async function getPartFileSize(mapId: string): Promise<number> {
  if (!mapId) return 0;
  try {
    const dir = await getExtractDirectory(false);
    if (!dir) return 0;
    const handle = await dir.getFileHandle(partFileName(mapId));
    const file = await handle.getFile();
    return file.size;
  } catch {
    return 0;
  }
}

export async function writeExtractMeta(mapId: string, meta: { totalBytes: number }): Promise<void> {
  const totalBytes = Math.max(0, Math.floor(Number(meta.totalBytes) || 0));
  if (!mapId || totalBytes <= 0) return;
  const dir = await getExtractDirectory(true);
  if (!dir) return;
  const handle = await dir.getFileHandle(metaFileName(mapId), { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify({ totalBytes }));
  await writable.close();
}

export async function readExtractMeta(mapId: string): Promise<{ totalBytes: number } | null> {
  if (!mapId) return null;
  try {
    const dir = await getExtractDirectory(false);
    if (!dir) return null;
    const handle = await dir.getFileHandle(metaFileName(mapId));
    const parsed = JSON.parse(await (await handle.getFile()).text());
    const totalBytes = Math.floor(Number(parsed?.totalBytes) || 0);
    if (totalBytes <= 0) return null;
    return { totalBytes };
  } catch {
    return null;
  }
}

export async function getExtractResumeInfo(mapId: string): Promise<{ partBytes: number; totalBytes: number }> {
  const [partBytes, meta] = await Promise.all([
    getPartFileSize(mapId),
    readExtractMeta(mapId),
  ]);
  return { partBytes, totalBytes: meta?.totalBytes ?? 0 };
}

async function removeExtractMeta(dir: FileSystemDirectoryHandle, mapId: string): Promise<void> {
  try {
    await dir.removeEntry(metaFileName(mapId));
  } catch {
    // ignore
  }
}

async function openPartWritable(
  handle: FileSystemFileHandle,
  offset: number
): Promise<FileSystemWritableFileStream> {
  const writable = await handle.createWritable({ keepExistingData: offset > 0 });
  if (offset > 0) {
    await writable.seek(offset);
  }
  return writable;
}

export async function writeExtractFromStream(
  mapId: string,
  stream: ReadableStream<Uint8Array>,
  onProgress?: (received: number) => void,
  options?: { startOffset?: number; checkpointBytes?: number }
): Promise<{ bytes: number }> {
  const dir = await getExtractDirectory(true);
  if (!dir) {
    throw new Error('Origin private file storage is not available in this browser');
  }

  const partName = partFileName(mapId);
  const finalName = extractFileName(mapId);
  const requestedOffset = Math.max(0, Math.floor(options?.startOffset ?? 0));
  const checkpointEvery = Math.max(0, options?.checkpointBytes ?? DEFAULT_CHECKPOINT_BYTES);
  const existingSize = await getPartFileSize(mapId);
  const append = requestedOffset > 0 && existingSize >= requestedOffset;
  const startOffset = append ? requestedOffset : 0;

  if (!append) {
    try {
      await dir.removeEntry(partName);
    } catch {
      // ignore
    }
  }

  const partHandle = await dir.getFileHandle(partName, { create: true });
  console.log(`[TILE_STREAM_CLIENT][store] Opening OPFS file '${partName}': startOffset=${startOffset}, append=${append}, existingSize=${existingSize}`);
  const reader = stream.getReader();
  let received = startOffset;
  let sinceCheckpoint = 0;
  let chunkCount = 0;
  let lastLogTime = Date.now();
  let lastCheckpointTime = Date.now();
  let lastLogBytes = received;

  if (startOffset > 0) onProgress?.(startOffset);

  // In Web Workers, use FileSystemSyncAccessHandle for direct in-place writes.
  // Unlike createWritable (which buffers to a temporary swap file that gets discarded if the tab closes),
  // FileSystemSyncAccessHandle writes directly into the file on disk and flushing commits in <1ms without thrashing.
  if (typeof (partHandle as any).createSyncAccessHandle === 'function') {
    const syncHandle = await (partHandle as any).createSyncAccessHandle();
    console.log(`[TILE_STREAM_CLIENT][store] Using FileSystemSyncAccessHandle for direct in-place writes: startOffset=${startOffset}`);
    try {
      if (startOffset > 0) {
        syncHandle.truncate(startOffset);
      } else {
        syncHandle.truncate(0);
      }

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[TILE_STREAM_CLIENT][store] Stream reader finished (done=true). Total bytes received: ${received}`);
          break;
        }
        if (!value || value.byteLength === 0) continue;
        syncHandle.write(value, { at: received });
        received += value.byteLength;
        sinceCheckpoint += value.byteLength;
        chunkCount++;
        onProgress?.(received);

        const now = Date.now();
        // Flush directly to disk every 4MB or 2 seconds.
        // syncHandle.flush() is an in-place fsync taking <1ms, ensuring that if the user
        // leaves the site, closes the tab, or navigates away, virtually all data is persisted.
        if (sinceCheckpoint >= 4 * 1024 * 1024 || (now - lastCheckpointTime) >= 2000) {
          syncHandle.flush();
          sinceCheckpoint = 0;
          lastCheckpointTime = now;
        }

        if (now - lastLogTime >= 3000) {
          const intervalSec = (now - lastLogTime) / 1000;
          const speedKBps = Math.round(((received - lastLogBytes) / 1024) / intervalSec);
          console.log(`[TILE_STREAM_CLIENT][store] Written ${received} bytes (${chunkCount} chunks, ~${speedKBps} KB/s)`);
          lastLogTime = now;
          lastLogBytes = received;
        }
      }

      syncHandle.flush();
      if (received < 127) {
        try { await dir.removeEntry(partName); } catch { /* ignore */ }
        throw new Error('Map extract was incomplete');
      }
    } catch (err) {
      console.error(`[TILE_STREAM_CLIENT][store] Stream read/write failed after ${received} bytes:`, err);
      try { syncHandle.flush(); } catch { /* ignore */ }
      throw err;
    } finally {
      syncHandle.close();
    }
  } else {
    // Fallback: createWritable for contexts where createSyncAccessHandle is unavailable
    let writable = await openPartWritable(partHandle, startOffset);
    let writableOpen = true;

    const persistWritable = async () => {
      if (!writableOpen) return;
      try {
        await writable.close();
      } catch (closeErr) {
        console.warn(`[TILE_STREAM_CLIENT][store] Error closing writable stream, attempting abort:`, closeErr);
        try { await writable.abort(); } catch { /* ignore */ }
      } finally {
        writableOpen = false;
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[TILE_STREAM_CLIENT][store] Stream reader finished (done=true). Total bytes received: ${received}`);
          break;
        }
        if (!value || value.byteLength === 0) continue;
        await writable.write(value as unknown as FileSystemWriteChunkType);
        received += value.byteLength;
        sinceCheckpoint += value.byteLength;
        chunkCount++;
        onProgress?.(received);

        const now = Date.now();
        if (now - lastLogTime >= 3000) {
          const intervalSec = (now - lastLogTime) / 1000;
          const speedKBps = Math.round(((received - lastLogBytes) / 1024) / intervalSec);
          console.log(`[TILE_STREAM_CLIENT][store] Written ${received} bytes (${chunkCount} chunks, ~${speedKBps} KB/s)`);
          lastLogTime = now;
          lastLogBytes = received;
        }

        if (checkpointEvery > 0 && sinceCheckpoint >= checkpointEvery && (now - lastCheckpointTime) >= MIN_CHECKPOINT_INTERVAL_MS) {
          console.log(`[TILE_STREAM_CLIENT][store] Checkpointing at ${received} bytes (flushing to disk, ${Math.round(sinceCheckpoint / (1024 * 1024))}MB since last checkpoint)...`);
          const cpStart = Date.now();
          await persistWritable();
          writable = await openPartWritable(partHandle, received);
          writableOpen = true;
          sinceCheckpoint = 0;
          lastCheckpointTime = Date.now();
          console.log(`[TILE_STREAM_CLIENT][store] Checkpoint completed in ${Date.now() - cpStart}ms`);
        }
      }
      await persistWritable();
      if (received < 127) {
        try { await dir.removeEntry(partName); } catch { /* ignore */ }
        throw new Error('Map extract was incomplete');
      }
    } catch (err) {
      console.error(`[TILE_STREAM_CLIENT][store] Stream read/write failed after ${received} bytes:`, err);
      await persistWritable();
      throw err;
    }
  }

  try {
    await dir.removeEntry(finalName);
  } catch {
    // ignore
  }

  let moved = false;
  if (typeof (partHandle as any).move === 'function') {
    try {
      await (partHandle as any).move(finalName);
      moved = true;
    } catch {
      moved = false;
    }
  }
  if (!moved) {
    const partFile = await partHandle.getFile();
    const dest = await dir.getFileHandle(finalName, { create: true });
    const destWritable = await dest.createWritable();
    if (typeof (partFile as any).stream === 'function') {
      const partStream = (partFile as any).stream() as ReadableStream<Uint8Array>;
      await partStream.pipeTo(destWritable);
    } else {
      await destWritable.write(await partFile.arrayBuffer());
      await destWritable.close();
    }
    try {
      await dir.removeEntry(partName);
    } catch {
      // keep the part file if remove fails; getExtractFile also accepts it
    }
  }
  await removeExtractMeta(dir, mapId);

  invalidateExtractCache(mapId);
  const file = await getExtractFile(mapId);
  return { bytes: file?.size ?? received };
}

export async function removeExtract(mapId: string): Promise<void> {
  invalidateExtractCache(mapId);
  const dir = await getExtractDirectory(false);
  if (!dir) return;
  for (const name of [extractFileName(mapId), partFileName(mapId), metaFileName(mapId)]) {
    try {
      await dir.removeEntry(name);
    } catch {
      // ignore
    }
  }
}

export async function removeAllExtracts(): Promise<void> {
  invalidateExtractCache();
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(EXTRACT_DIR, { recursive: true });
  } catch (err) {
    if (isNotFoundError(err)) return;
    const dir = await getExtractDirectory(false);
    if (!dir) return;
    if (typeof (dir as any).entries === 'function') {
      for await (const [name] of (dir as any).entries()) {
        try {
          await dir.removeEntry(name);
        } catch {
          // ignore
        }
      }
    }
  }
}

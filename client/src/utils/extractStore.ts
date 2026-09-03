const EXTRACT_DIR = 'offline-extracts';
const extractCache = new Map<string, File | null>();

function sanitizeMapId(mapId: string): string {
  return mapId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extractFileName(mapId: string): string {
  return `${sanitizeMapId(mapId)}.pmtiles`;
}

function partFileName(mapId: string): string {
  return `${sanitizeMapId(mapId)}.pmtiles.part`;
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

export async function writeExtractFromStream(
  mapId: string,
  stream: ReadableStream<Uint8Array>,
  onProgress?: (received: number) => void
): Promise<{ bytes: number }> {
  const dir = await getExtractDirectory(true);
  if (!dir) {
    throw new Error('Origin private file storage is not available in this browser');
  }

  const partName = partFileName(mapId);
  const finalName = extractFileName(mapId);
  try {
    await dir.removeEntry(partName);
  } catch {
    // ignore
  }

  const partHandle = await dir.getFileHandle(partName, { create: true });
  const writable = await partHandle.createWritable();
  const reader = stream.getReader();
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      await writable.write(value as unknown as FileSystemWriteChunkType);
      received += value.byteLength;
      onProgress?.(received);
    }
    await writable.close();
    if (received < 127) {
      throw new Error('Map extract was incomplete');
    }
  } catch (err) {
    try { await writable.abort(); } catch { /* ignore */ }
    try { await dir.removeEntry(partName); } catch { /* ignore */ }
    throw err;
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
    await destWritable.write(await partFile.arrayBuffer());
    await destWritable.close();
    try {
      await dir.removeEntry(partName);
    } catch {
      // keep the part file if remove fails; getExtractFile also accepts it
    }
  }

  invalidateExtractCache(mapId);
  const file = await getExtractFile(mapId);
  return { bytes: file?.size ?? received };
}

export async function removeExtract(mapId: string): Promise<void> {
  invalidateExtractCache(mapId);
  const dir = await getExtractDirectory(false);
  if (!dir) return;
  for (const name of [extractFileName(mapId), partFileName(mapId)]) {
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

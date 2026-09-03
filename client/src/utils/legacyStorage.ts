export type LeftoverKind = 'indexeddb' | 'opfs' | 'cache' | 'localStorage';

export interface LeftoverStorageItem {
  id: string;
  kind: LeftoverKind;
  name: string;
  detail: string;
}

const CURRENT_INDEXED_DB = 'MapTilesDB_v2';
const CURRENT_OPFS_DIR = 'offline-extracts';

const KNOWN_CACHE_NAMES = new Set([
  'api-cache',
  'protomaps-assets-cache',
  'elevation-tiles-cache',
  'fonts-cache',
  'sprites-cache',
]);

const KNOWN_LOCAL_STORAGE_KEYS = new Set([
  'token',
  'cached_maps',
  'cached_download_statuses',
  'customColors',
  'ourmaps_map_theme',
  'ourmaps_hillshade',
  'ourmaps_3d',
  'ourmaps_3d_terrain',
  'ourmaps_3d_buildings',
  'ourmaps_satellite',
]);

const KNOWN_LOCAL_STORAGE_PREFIXES = [
  'ourmaps_visibility_',
  'ourmaps_collapsed_',
];

export function isKnownIndexedDbName(name: string): boolean {
  return name === CURRENT_INDEXED_DB;
}

export function isKnownOpfsEntry(name: string): boolean {
  return name === CURRENT_OPFS_DIR;
}

export function isKnownCacheName(name: string): boolean {
  if (KNOWN_CACHE_NAMES.has(name)) return true;
  if (name.startsWith('workbox-')) return true;
  return false;
}

export function isKnownLocalStorageKey(key: string): boolean {
  if (KNOWN_LOCAL_STORAGE_KEYS.has(key)) return true;
  return KNOWN_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function leftoverId(kind: LeftoverKind, name: string): string {
  return `${kind}:${name}`;
}

function describeItem(kind: LeftoverKind, name: string): string {
  switch (kind) {
    case 'indexeddb':
      return `Old map database (${name})`;
    case 'opfs':
      return `Old map files (${name})`;
    case 'cache':
      return `Old cached map data (${name})`;
    case 'localStorage':
      return `Old saved setting (${name})`;
  }
}

async function listIndexedDbNames(): Promise<string[]> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    return [];
  }
  try {
    const dbs = await indexedDB.databases();
    return dbs.map((db) => db.name).filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

async function listOpfsRootNames(): Promise<string[]> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return [];
  }
  try {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    const dir = root as FileSystemDirectoryHandle & {
      keys?: () => AsyncIterable<string>;
      entries?: () => AsyncIterable<[string, FileSystemHandle]>;
    };
    if (typeof dir.keys === 'function') {
      for await (const name of dir.keys()) names.push(name);
    } else if (typeof dir.entries === 'function') {
      for await (const [name] of dir.entries()) names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}

async function listCacheNames(): Promise<string[]> {
  if (typeof caches === 'undefined' || typeof caches.keys !== 'function') {
    return [];
  }
  try {
    return await caches.keys();
  } catch {
    return [];
  }
}

function listLocalStorageKeys(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

export async function findUnrecognizedStorage(): Promise<LeftoverStorageItem[]> {
  const items: LeftoverStorageItem[] = [];

  for (const name of await listIndexedDbNames()) {
    if (isKnownIndexedDbName(name)) continue;
    items.push({
      id: leftoverId('indexeddb', name),
      kind: 'indexeddb',
      name,
      detail: describeItem('indexeddb', name),
    });
  }

  for (const name of await listOpfsRootNames()) {
    if (isKnownOpfsEntry(name)) continue;
    items.push({
      id: leftoverId('opfs', name),
      kind: 'opfs',
      name,
      detail: describeItem('opfs', name),
    });
  }

  for (const name of await listCacheNames()) {
    if (isKnownCacheName(name)) continue;
    items.push({
      id: leftoverId('cache', name),
      kind: 'cache',
      name,
      detail: describeItem('cache', name),
    });
  }

  for (const name of listLocalStorageKeys()) {
    if (isKnownLocalStorageKey(name)) continue;
    items.push({
      id: leftoverId('localStorage', name),
      kind: 'localStorage',
      name,
      detail: describeItem('localStorage', name),
    });
  }

  return items;
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error(`Failed to delete database ${name}`));
    req.onblocked = () => resolve();
  });
}

async function deleteOpfsEntry(name: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(name, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/could not be found/i.test(message) || (err as { name?: string })?.name === 'NotFoundError') {
      return;
    }
    throw err;
  }
}

export async function deleteUnrecognizedStorage(items: LeftoverStorageItem[]): Promise<void> {
  const errors: string[] = [];
  for (const item of items) {
    try {
      if (item.kind === 'indexeddb') {
        await deleteIndexedDb(item.name);
      } else if (item.kind === 'opfs') {
        await deleteOpfsEntry(item.name);
      } else if (item.kind === 'cache') {
        if (typeof caches !== 'undefined') await caches.delete(item.name);
      } else if (item.kind === 'localStorage') {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(item.name);
      }
    } catch (err) {
      errors.push(`${item.detail}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

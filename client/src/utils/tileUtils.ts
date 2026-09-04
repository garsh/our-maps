import type { Pin, MapData } from '@shared/interfaces';
import { extractExists, getExtractResumeInfo, getPartFileSize, removeAllExtracts, removeExtract } from './extractStore';

export interface BoundingBox {
    north: number;
    east: number;
    south: number;
    west: number;
}

export interface TileInfo {
    x: number;
    y: number;
    z: number;
    url: string;
}

const DB_NAME = 'MapTilesDB_v2';
const MANIFEST_STORE = 'manifest';
const TILE_STORE = 'tiles';
const MAP_STORE = 'maps';
const DB_VERSION = 6;

let dbPromise: Promise<IDBDatabase> | null = null;

export function resetDBForTesting(): void {
    dbPromise = null;
}

export async function openDB(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is not supported in this environment'));
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = request.result;
                const oldVersion = event?.oldVersion ?? 0;
                if (!db.objectStoreNames.contains(MAP_STORE)) {
                    const store = db.createObjectStore(MAP_STORE, { keyPath: 'id' });
                    if (store?.createIndex) {
                        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
                    }
                } else if (oldVersion < 6) {
                    // Upgrade: add lastAccessedAt index to existing store
                    const tx = (event?.target as IDBOpenDBRequest)?.transaction || request.transaction;
                    if (tx) {
                        const store = tx.objectStore(MAP_STORE);
                        if (store?.indexNames && !store.indexNames.contains('lastAccessedAt') && store.createIndex) {
                            store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
                        }
                    }
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onclose = () => {
                    dbPromise = null;
                };
                db.onversionchange = () => {
                    db.close();
                    dbPromise = null;
                };
                resolve(db);
            };
            request.onerror = () => {
                dbPromise = null;
                reject(request.error);
            };
        });
    }
    return dbPromise;
}

export async function saveMapOffline(mapData: MapData): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MAP_STORE, 'readwrite');
        const store = transaction.objectStore(MAP_STORE);
        const req = store.put({ ...mapData, isExplicitDownload: true, lastAccessedAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        transaction.onerror = () => reject(transaction.error);
    });
}

export async function getOfflineMap(mapId: string): Promise<MapData | null> {
    if (!mapId || typeof indexedDB === 'undefined') return null;
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(MAP_STORE, 'readonly');
            const store = transaction.objectStore(MAP_STORE);
            const request = store.get(mapId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch {
        return null;
    }
}

const VIEW_CACHE_MAX = 20;
const VIEW_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Save a map fetched from the network into the view cache.
 * Sets lastAccessedAt and etag; marks isExplicitDownload = false so
 * LRU eviction may remove it when the cache exceeds VIEW_CACHE_MAX.
 * Explicit offline downloads (isExplicitDownload = true) are never touched.
 */
export async function saveMapToViewCache(mapData: MapData, etag?: string): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(MAP_STORE, 'readwrite');
            const store = tx.objectStore(MAP_STORE);
            // Preserve isExplicitDownload if the record already exists
            const getReq = store.get(mapData.id);
            getReq.onsuccess = () => {
                const existing = getReq.result as (MapData & { isExplicitDownload?: boolean; etag?: string }) | undefined;
                if (existing?.isExplicitDownload) {
                    // Already a pinned offline download — only update data, keep flag
                    const putReq = store.put({
                        ...mapData,
                        isExplicitDownload: true,
                        etag: etag ?? existing.etag,
                        lastAccessedAt: Date.now(),
                    });
                    putReq.onsuccess = () => resolve();
                    putReq.onerror = () => reject(putReq.error);
                } else {
                    const putReq = store.put({
                        ...mapData,
                        isExplicitDownload: false,
                        etag: etag ?? null,
                        lastAccessedAt: Date.now(),
                    });
                    putReq.onsuccess = () => resolve();
                    putReq.onerror = () => reject(putReq.error);
                }
            };
            getReq.onerror = () => reject(getReq.error);
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // Non-critical: ignore cache write failures
    }
}

/** Return the stored ETag for a cached map, or null if not cached / no etag. */
export async function getMapETag(mapId: string): Promise<string | null> {
    if (!mapId || typeof indexedDB === 'undefined') return null;
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(MAP_STORE, 'readonly');
            const req = tx.objectStore(MAP_STORE).get(mapId);
            req.onsuccess = () => resolve((req.result as any)?.etag ?? null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

/** Touch lastAccessedAt on a cache hit so the LRU order stays accurate. */
export async function touchMapCacheAccess(mapId: string): Promise<void> {
    if (!mapId || typeof indexedDB === 'undefined') return;
    try {
        const db = await openDB();
        await new Promise<void>((resolve) => {
            const tx = db.transaction(MAP_STORE, 'readwrite');
            const store = tx.objectStore(MAP_STORE);
            const getReq = store.get(mapId);
            getReq.onsuccess = () => {
                if (!getReq.result) { resolve(); return; }
                const putReq = store.put({ ...getReq.result, lastAccessedAt: Date.now() });
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => resolve();
            };
            getReq.onerror = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch {
        // Non-critical
    }
}

/**
 * Prune view-only cached maps (isExplicitDownload = false) using LRU.
 * Evicts entries older than VIEW_CACHE_TTL_MS, then caps at VIEW_CACHE_MAX.
 * Explicit offline downloads are never touched.
 * Safe to call speculatively; all errors are swallowed.
 */
export async function pruneViewCache(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
        const db = await openDB();
        const all: (MapData & { isExplicitDownload?: boolean; lastAccessedAt?: number })[] = await new Promise((resolve, reject) => {
            const tx = db.transaction(MAP_STORE, 'readonly');
            const req = tx.objectStore(MAP_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });

        const now = Date.now();
        const viewOnly = all.filter(m => !m.isExplicitDownload);
        const toDelete: string[] = [];

        // Evict stale entries
        for (const m of viewOnly) {
            const age = now - (m.lastAccessedAt ?? 0);
            if (age > VIEW_CACHE_TTL_MS) toDelete.push(m.id);
        }

        // Evict oldest beyond cap
        const remaining = viewOnly
            .filter(m => !toDelete.includes(m.id))
            .sort((a, b) => (a.lastAccessedAt ?? 0) - (b.lastAccessedAt ?? 0));
        if (remaining.length > VIEW_CACHE_MAX) {
            const overflow = remaining.slice(0, remaining.length - VIEW_CACHE_MAX);
            for (const m of overflow) toDelete.push(m.id);
        }

        if (toDelete.length === 0) return;

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(MAP_STORE, 'readwrite');
            const store = tx.objectStore(MAP_STORE);
            for (const id of toDelete) store.delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // Non-critical
    }
}

export async function listOfflineMaps(): Promise<MapData[]> {
    if (typeof indexedDB === 'undefined') return [];
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(MAP_STORE, 'readonly');
            const store = transaction.objectStore(MAP_STORE);
            const request = store.getAll();
            request.onsuccess = () => resolve((request.result as MapData[]) || []);
            request.onerror = () => reject(request.error);
        });
    } catch {
        return [];
    }
}

export interface MapDownloadStatus {
    isComplete: boolean;
    isPartial: boolean;
}

export async function getDownloadStats(mapId: string): Promise<{ total: number, completed: number }> {
    if (!mapId) return { total: 0, completed: 0 };
    const map = await getOfflineMap(mapId);
    if (!map) return { total: 0, completed: 0 };
    const total = map.totalTiles || 0;
    const hasExtract = await extractExists(mapId);
    if (hasExtract) {
        const n = total > 0 ? total : 1;
        return { total: n, completed: n };
    }
    const resume = await getExtractResumeInfo(mapId);
    const totalBytes = resume.totalBytes || map.extractTotalBytes || 0;
    if (resume.partBytes > 0 && totalBytes > 0) {
        const n = total > 0 ? total : 1;
        return { total: n, completed: Math.round(Math.min(1, resume.partBytes / totalBytes) * n) };
    }
    return { total, completed: map.completedTiles || 0 };
}

/** @deprecated Use getDownloadStats. Kept so existing callers keep compiling. */
export const getManifestStats = getDownloadStats;

export async function getMapDownloadStatuses(mapIds?: string[]): Promise<Map<string, MapDownloadStatus>> {
    const resultMap = new Map<string, MapDownloadStatus>();
    const maps = await listOfflineMaps();
    const targetIdSet = Array.isArray(mapIds) && mapIds.length > 0 ? new Set(mapIds) : null;

    const idsToCheck = new Set<string>();
    for (const map of maps) {
        if (!targetIdSet || targetIdSet.has(map.id)) idsToCheck.add(map.id);
    }
    if (targetIdSet) {
        for (const id of targetIdSet) idsToCheck.add(id);
    }

    const mapsById = new Map(maps.map((map) => [map.id, map]));
    await Promise.all([...idsToCheck].map(async (id) => {
        if (await extractExists(id)) {
            resultMap.set(id, { isComplete: true, isPartial: false });
            return;
        }
        const map = mapsById.get(id);
        const completed = map?.completedTiles || 0;
        const total = map?.totalTiles || 0;
        const partBytes = await getPartFileSize(id);
        if (partBytes > 0 || (total > 0 && completed < total)) {
            resultMap.set(id, { isComplete: false, isPartial: true });
        }
    }));
    return resultMap;
}

export async function isMapDownloaded(mapId: string): Promise<boolean> {
    return extractExists(mapId);
}

async function clearLegacyTileStores(db: IDBDatabase): Promise<void> {
    const leftover: string[] = [];
    if (db.objectStoreNames.contains(TILE_STORE)) leftover.push(TILE_STORE);
    if (db.objectStoreNames.contains(MANIFEST_STORE)) leftover.push(MANIFEST_STORE);
    if (db.objectStoreNames.contains(MAP_STORE)) leftover.push(MAP_STORE);
    if (leftover.length === 0) return;

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(leftover, 'readwrite');
        for (const name of leftover) {
            const store = tx.objectStore(name);
            if (typeof store.clear === 'function') store.clear();
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
}

export async function removeAllDownloads(): Promise<void> {
    await removeAllExtracts();
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('cached_download_statuses');
    }
    if (typeof indexedDB === 'undefined') return;

    try {
        const db = await openDB();
        await clearLegacyTileStores(db);
        db.close();
    } catch {
        // ignore
    }
    dbPromise = null;

    await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => {
            resolve();
        };
    });
}

export async function removeMapDownload(mapId: string): Promise<void> {
    if (!mapId) return;
    await removeExtract(mapId);
    if (typeof indexedDB === 'undefined') return;

    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MAP_STORE, 'readwrite');
        tx.objectStore(MAP_STORE).delete(mapId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
}

export function getXRanges(west: number, east: number, zoom: number, buffer = 0): Array<[number, number]> {
    const maxTile = (1 << zoom) - 1;
    const rawXMin = longToX(west, zoom) - buffer;
    const rawXMax = longToX(east, zoom) + buffer;
    if (west <= east) {
        const xMin = Math.max(0, Math.min(maxTile, Math.min(rawXMin, rawXMax)));
        const xMax = Math.max(0, Math.min(maxTile, Math.max(rawXMin, rawXMax)));
        return [[xMin, xMax]];
    }
    const xMin = Math.max(0, Math.min(maxTile, rawXMin));
    const xMax = Math.max(0, Math.min(maxTile, rawXMax));
    return [
        [xMin, maxTile],
        [0, xMax]
    ];
}

export function getYRange(north: number, south: number, zoom: number, buffer = 0): [number, number] {
    const maxTile = (1 << zoom) - 1;
    const yMin = latToY(north, zoom);
    const yMax = latToY(south, zoom);
    const yStart = Math.max(0, Math.min(yMin, yMax) - buffer);
    const yEnd = Math.min(maxTile, Math.max(yMin, yMax) + buffer);
    return [yStart, yEnd];
}

export function countTiles(box: BoundingBox, minZoom: number, maxZoom: number): number {
    let count = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
        if (z <= 4) {
            const maxTile = (1 << z) - 1;
            count += (maxTile + 1) * (maxTile + 1);
        } else {
            const buffer = (z >= 5 && z <= 8) ? 2 : (z === 9 ? 1 : 0);
            const [yStart, yEnd] = getYRange(box.north, box.south, z, buffer);
            const height = yEnd - yStart + 1;

            const xRanges = getXRanges(box.west, box.east, z, buffer);
            for (const [xStart, xEnd] of xRanges) {
                const width = xEnd - xStart + 1;
                count += (width * height);
            }
        }
    }
    return count;
}

export function estimateSizeMB(tileCount: number): number {
    return (tileCount * 20.0) / 1024.0;
}

function longToX(lon: number, zoom: number): number {
    const x = Math.floor(((lon + 180.0) / 360.0) * (1 << zoom));
    return ((x % (1 << zoom)) + (1 << zoom)) % (1 << zoom);
}

function latToY(lat: number, zoom: number): number {
    const latRad = lat * Math.PI / 180.0;
    const y = Math.floor(((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0) * (1 << zoom));
    return Math.max(0, Math.min((1 << zoom) - 1, y));
}

export function getTilesForArea(box: BoundingBox, minZoom: number, maxZoom: number): TileInfo[] {
    const totalCount = countTiles(box, minZoom, maxZoom);
    const tiles: TileInfo[] = new Array(totalCount);
    let index = 0;
    const origin = typeof window !== 'undefined'
        ? window.location.origin
        : (typeof self !== 'undefined' && self.location ? self.location.origin : '');

    for (let z = minZoom; z <= maxZoom; z++) {
        if (z <= 4) {
            const maxTile = (1 << z) - 1;
            for (let x = 0; x <= maxTile; x++) {
                for (let y = 0; y <= maxTile; y++) {
                    tiles[index++] = {
                        x, y, z,
                        url: `${origin}/maps/tile/${z}/${x}/${y}.mvt`
                    };
                }
            }
        } else {
            const buffer = (z >= 5 && z <= 8) ? 2 : (z === 9 ? 1 : 0);
            const [yStart, yEnd] = getYRange(box.north, box.south, z, buffer);
            const xRanges = getXRanges(box.west, box.east, z, buffer);

            for (const [xStart, xEnd] of xRanges) {
                for (let x = xStart; x <= xEnd; x++) {
                    for (let y = yStart; y <= yEnd; y++) {
                        tiles[index++] = {
                            x, y, z,
                            url: `${origin}/maps/tile/${z}/${x}/${y}.mvt`
                        };
                    }
                }
            }
        }
    }
    return tiles;
}

export function getPinsBoundingBox(pins: Pin[]): BoundingBox | null {
    if (pins.length === 0) return null;

    let north = -90;
    let south = 90;
    let east = -180;
    let west = 180;

    if (pins.length === 1) {
        const p = pins[0];
        return {
            north: Math.min(85, p.lat + 0.15),
            south: Math.max(-85, p.lat - 0.15),
            east: Math.min(180, p.lng + 0.15),
            west: Math.max(-180, p.lng - 0.15)
        };
    }

    pins.forEach(pin => {
        if (pin.lat > north) north = pin.lat;
        if (pin.lat < south) south = pin.lat;
        if (pin.lng > east) east = pin.lng;
        if (pin.lng < west) west = pin.lng;
    });

    const latSpan = north - south;
    const lngSpan = east - west;
    const margin = Math.max(0.15, Math.min(0.40, Math.max(latSpan, lngSpan) * 0.15));

    return {
        north: Math.min(85, north + margin),
        south: Math.max(-85, south - margin),
        east: Math.min(180, east + margin),
        west: Math.max(-180, west - margin)
    };
}

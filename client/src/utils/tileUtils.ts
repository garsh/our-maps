import type { Pin, MapData } from '@shared/interfaces';

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

export type TileStatus = 'pending' | 'completed' | 'error';

export interface ManifestEntry {
    url: string;
    x: number;
    y: number;
    z: number;
    status: TileStatus;
    mapId: string;
    updatedAt: number;
}

/**
 * IndexedDB Tile Store
 */
const DB_NAME = 'MapTilesDB_v2';
const MANIFEST_STORE = 'manifest';
const TILE_STORE = 'tiles';
const MAP_STORE = 'maps';
const DB_VERSION = 4;

function keyRangeOnly(key: any): any {
    return typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.only(key) : key;
}

let dbPromise: Promise<IDBDatabase> | null = null;
const tileMissCache = new Set<string>();
const MAX_MISS_CACHE_SIZE = 10000;

const MAX_HIT_CACHE_SIZE = 250;
const tileHitCache = new Map<string, Uint8Array>();

export function clearTileMissCache(): void {
    tileMissCache.clear();
}

export function clearTileHitCache(): void {
    tileHitCache.clear();
}

export function clearTileCaches(): void {
    tileMissCache.clear();
    tileHitCache.clear();
}

function recordTileMiss(url: string): void {
    if (tileMissCache.size >= MAX_MISS_CACHE_SIZE) {
        tileMissCache.clear();
    }
    tileMissCache.add(url);
}

function recordTileHit(key: string, data: Uint8Array): void {
    if (tileHitCache.has(key)) {
        tileHitCache.delete(key);
    } else if (tileHitCache.size >= MAX_HIT_CACHE_SIZE) {
        const oldestKey = tileHitCache.keys().next().value;
        if (oldestKey !== undefined) tileHitCache.delete(oldestKey);
    }
    tileHitCache.set(key, data);
}

function getCachedTile(key: string): Uint8Array | null {
    const data = tileHitCache.get(key);
    if (data) {
        tileHitCache.delete(key);
        tileHitCache.set(key, data);
        return data;
    }
    return null;
}

export function resetDBForTesting(): void {
    dbPromise = null;
    tileMissCache.clear();
    tileHitCache.clear();
}

export async function openDB(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is not supported in this environment'));
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event: any) => {
                const db = request.result;
                const tx = event?.target?.transaction || (request as any).transaction;
                let manifest: IDBObjectStore | undefined;
                if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
                    manifest = db.createObjectStore(MANIFEST_STORE, { keyPath: 'url' });
                    manifest.createIndex('status', 'status', { unique: false });
                    manifest.createIndex('mapId', 'mapId', { unique: false });
                    manifest.createIndex('mapId_status', ['mapId', 'status'], { unique: false });
                } else if (tx) {
                    manifest = tx.objectStore(MANIFEST_STORE);
                    if (manifest && !manifest.indexNames.contains('mapId_status')) {
                        manifest.createIndex('mapId_status', ['mapId', 'status'], { unique: false });
                    }
                }
                if (!db.objectStoreNames.contains(TILE_STORE)) {
                    db.createObjectStore(TILE_STORE);
                }
                if (!db.objectStoreNames.contains(MAP_STORE)) {
                    db.createObjectStore(MAP_STORE, { keyPath: 'id' });
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
        const req = store.put(mapData);
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

export async function addToManifest(entries: ManifestEntry[]): Promise<ManifestEntry[]> {
    if (!entries || entries.length === 0) return [];
    const db = await openDB();
    const CHUNK_SIZE = 1000;
    const pendingEntries: ManifestEntry[] = [];

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        const chunk = entries.slice(i, i + CHUNK_SIZE);
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(MANIFEST_STORE, 'readwrite');
            const store = transaction.objectStore(MANIFEST_STORE);

            chunk.forEach(entry => {
                if (entry.status === 'completed') {
                    store.put(entry);
                } else {
                    const getReq = store.get(entry.url);
                    getReq.onsuccess = () => {
                        const existing = getReq.result as ManifestEntry | undefined;
                        if (!existing || existing.status !== 'completed') {
                            store.put(entry);
                            pendingEntries.push(entry);
                        }
                    };
                }
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
        });
    }
    return pendingEntries;
}


export async function getPendingFromManifest(mapId: string): Promise<ManifestEntry[]> {
    if (!mapId || typeof indexedDB === 'undefined') return [];
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(MANIFEST_STORE, 'readonly');
            const store = transaction.objectStore(MANIFEST_STORE);

            if (store.indexNames && store.indexNames.contains('mapId_status')) {
                const compoundIndex = store.index('mapId_status');
                const pendingReq = compoundIndex.getAll(keyRangeOnly([mapId, 'pending'] as any));
                const errorReq = compoundIndex.getAll(keyRangeOnly([mapId, 'error'] as any));

                let pendingList: ManifestEntry[] | null = null;
                let errorList: ManifestEntry[] | null = null;

                const checkDone = () => {
                    if (pendingList !== null && errorList !== null) {
                        resolve([...pendingList, ...errorList]);
                    }
                };

                pendingReq.onsuccess = () => {
                    pendingList = (pendingReq.result as ManifestEntry[]) || [];
                    checkDone();
                };
                pendingReq.onerror = () => reject(pendingReq.error);

                errorReq.onsuccess = () => {
                    errorList = (errorReq.result as ManifestEntry[]) || [];
                    checkDone();
                };
                errorReq.onerror = () => reject(errorReq.error);
                return;
            }

            const index = store.index('mapId');
            const request = index.getAll(keyRangeOnly(mapId));

            request.onsuccess = () => {
                const all = (request.result as ManifestEntry[]) || [];
                resolve(all.filter(e => e.status === 'pending' || e.status === 'error'));
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return [];
    }
}

export async function getManifestStats(mapId: string): Promise<{ total: number, completed: number }> {
    if (!mapId || typeof indexedDB === 'undefined') return { total: 0, completed: 0 };
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const hasManifest = db.objectStoreNames.contains(MANIFEST_STORE);
            const stores = hasManifest ? [MAP_STORE, MANIFEST_STORE] : [MAP_STORE];
            const transaction = db.transaction(stores, 'readonly');
            const mapStore = transaction.objectStore(MAP_STORE);
            const mapReq = mapStore.get(mapId);

            mapReq.onsuccess = () => {
                const map = mapReq.result as MapData | undefined;
                if (map && map.totalTiles !== undefined && map.completedTiles !== undefined) {
                    resolve({ total: map.totalTiles, completed: map.completedTiles });
                    return;
                }

                if (hasManifest) {
                    const manifestStore = transaction.objectStore(MANIFEST_STORE);
                    if (manifestStore.indexNames && manifestStore.indexNames.contains('mapId_status')) {
                        const compoundIndex = manifestStore.index('mapId_status');
                        const index = manifestStore.index('mapId');
                        const totalReq = index.count(keyRangeOnly(mapId));
                        const completedReq = compoundIndex.count(keyRangeOnly([mapId, 'completed'] as any));

                        let total: number | null = null;
                        let completed: number | null = null;
                        const checkDone = () => {
                            if (total !== null && completed !== null) {
                                if (total === 0 && map) {
                                    const bbox = map.pins ? getPinsBoundingBox(map.pins) : null;
                                    const computedTotal = bbox ? countTiles(bbox, 1, 15) : 0;
                                    const isDone = map.isDownloaded === true;
                                    resolve({ total: computedTotal, completed: isDone ? computedTotal : 0 });
                                } else {
                                    resolve({ total, completed });
                                }
                            }
                        };
                        totalReq.onsuccess = () => { total = totalReq.result || 0; checkDone(); };
                        totalReq.onerror = () => { total = 0; checkDone(); };
                        completedReq.onsuccess = () => { completed = completedReq.result || 0; checkDone(); };
                        completedReq.onerror = () => { completed = 0; checkDone(); };
                        return;
                    } else if (manifestStore.indexNames && manifestStore.indexNames.contains('mapId')) {
                        const index = manifestStore.index('mapId');
                        const totalReq = index.count(keyRangeOnly(mapId));
                        totalReq.onsuccess = () => {
                            const total = totalReq.result || 0;
                            resolve({ total, completed: total });
                        };
                        totalReq.onerror = () => resolve({ total: 0, completed: 0 });
                        return;
                    }
                }

                if (map) {
                    const bbox = map.pins ? getPinsBoundingBox(map.pins) : null;
                    const total = bbox ? countTiles(bbox, 1, 15) : 0;
                    const isDone = map.isDownloaded === true;
                    resolve({ total, completed: isDone ? total : 0 });
                } else {
                    resolve({ total: 0, completed: 0 });
                }
            };
            mapReq.onerror = () => resolve({ total: 0, completed: 0 });
        });
    } catch {
        return { total: 0, completed: 0 };
    }
}


export interface MapDownloadStatus {
    isComplete: boolean;
    isPartial: boolean;
}

export async function getMapDownloadStatuses(mapIds?: string[]): Promise<Map<string, MapDownloadStatus>> {
    if (typeof indexedDB === 'undefined') return new Map();
    try {
        const db = await openDB();
        const resultMap = new Map<string, MapDownloadStatus>();

        return new Promise((resolve) => {
            const hasManifest = db.objectStoreNames.contains(MANIFEST_STORE);
            const stores = hasManifest ? [MAP_STORE, MANIFEST_STORE] : [MAP_STORE];
            const transaction = db.transaction(stores, 'readonly');
            const mapStore = transaction.objectStore(MAP_STORE);
            const targetIdSet = Array.isArray(mapIds) && mapIds.length > 0 ? new Set(mapIds) : null;

            const mapReq = mapStore.getAll();

            mapReq.onsuccess = () => {
                const offlineMaps = (mapReq.result as MapData[]) || [];
                const candidateIds = new Set<string>();

                for (const map of offlineMaps) {
                    if (!targetIdSet || targetIdSet.has(map.id)) {
                        candidateIds.add(map.id);
                        const isPartial = map.completedTiles !== undefined && map.totalTiles !== undefined && map.completedTiles < map.totalTiles;
                        resultMap.set(map.id, { isComplete: !isPartial, isPartial });
                    }
                }

                if (!hasManifest) {
                    resolve(resultMap);
                    return;
                }

                const manifestStore = transaction.objectStore(MANIFEST_STORE);
                if (!manifestStore.indexNames || !manifestStore.indexNames.contains('mapId_status')) {
                    resolve(resultMap);
                    return;
                }

                const checkCandidates = (ids: string[]) => {
                    const idsToCheck = ids.filter(id => !resultMap.has(id));
                    if (idsToCheck.length === 0) {
                        resolve(resultMap);
                        return;
                    }

                    const index = manifestStore.index('mapId_status');
                    let pendingChecks = idsToCheck.length;

                    for (const id of idsToCheck) {
                        const completedReq = index.count(keyRangeOnly([id, 'completed'] as any));
                        const pendingReq = index.count(keyRangeOnly([id, 'pending'] as any));
                        const errorReq = index.count(keyRangeOnly([id, 'error'] as any));

                        let doneReqs = 0;
                        let compCount = 0;
                        let pendCount = 0;
                        let errCount = 0;

                        const checkIdDone = () => {
                            doneReqs++;
                            if (doneReqs === 3) {
                                const total = compCount + pendCount + errCount;
                                if (total > 0) {
                                    resultMap.set(id, {
                                        isComplete: compCount === total && total > 0,
                                        isPartial: compCount < total
                                    });
                                }
                                pendingChecks--;
                                if (pendingChecks === 0) {
                                    resolve(resultMap);
                                }
                            }
                        };

                        completedReq.onsuccess = () => { compCount = completedReq.result || 0; checkIdDone(); };
                        completedReq.onerror = () => checkIdDone();
                        pendingReq.onsuccess = () => { pendCount = pendingReq.result || 0; checkIdDone(); };
                        pendingReq.onerror = () => checkIdDone();
                        errorReq.onsuccess = () => { errCount = errorReq.result || 0; checkIdDone(); };
                        errorReq.onerror = () => checkIdDone();
                    }
                };

                if (targetIdSet) {
                    for (const id of targetIdSet) {
                        candidateIds.add(id);
                    }
                    checkCandidates(Array.from(candidateIds));
                } else if (manifestStore.indexNames.contains('mapId')) {
                    const mapIdIndex = manifestStore.index('mapId');
                    if (typeof (mapIdIndex as any).openKeyCursor === 'function') {
                        const cursorReq = (mapIdIndex as any).openKeyCursor(null, 'nextunique');
                        cursorReq.onsuccess = () => {
                            const cursor = cursorReq.result;
                            if (cursor) {
                                if (cursor.key) candidateIds.add(cursor.key as string);
                                cursor.continue();
                            } else {
                                checkCandidates(Array.from(candidateIds));
                            }
                        };
                        cursorReq.onerror = () => checkCandidates(Array.from(candidateIds));
                    } else {
                        checkCandidates(Array.from(candidateIds));
                    }
                } else {
                    checkCandidates(Array.from(candidateIds));
                }
            };
            mapReq.onerror = () => resolve(resultMap);
        });
    } catch {
        return new Map();
    }
}

export async function isMapDownloaded(mapId: string): Promise<boolean> {
    if (!mapId || typeof indexedDB === 'undefined') return false;
    const offlineMap = await getOfflineMap(mapId);
    return Boolean(offlineMap);
}

export async function removeAllDownloads(): Promise<void> {
    clearTileCaches();
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('cached_download_statuses');
    }
    if (typeof indexedDB === 'undefined') return;

    if (dbPromise) {
        try {
            const db = await dbPromise;
            db.close();
        } catch {
            // ignore
        }
        dbPromise = null;
    }

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
    clearTileCaches();
    const db = await openDB();

    // 1. Get deleting map and delete map from MAP_STORE, then get other remaining maps
    const { deletingMap, otherMaps } = await new Promise<{ deletingMap?: MapData; otherMaps: MapData[] }>((resolve, reject) => {
        const tx = db.transaction(MAP_STORE, 'readwrite');
        const mapStore = tx.objectStore(MAP_STORE);
        const getReq = mapStore.get(mapId);
        getReq.onsuccess = () => {
            const deletingMap = getReq.result as MapData | undefined;
            mapStore.delete(mapId);
            const getAllReq = mapStore.getAll();
            getAllReq.onsuccess = () => resolve({ deletingMap, otherMaps: (getAllReq.result as MapData[]) || [] });
            getAllReq.onerror = () => reject(getAllReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
    });

    // 2. If no other maps exist, fast clear everything
    if (otherMaps.length === 0) {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([MANIFEST_STORE, TILE_STORE], 'readwrite');
            const manifestStore = tx.objectStore(MANIFEST_STORE);
            const tileStore = tx.objectStore(TILE_STORE);
            if (typeof manifestStore.clear === 'function') manifestStore.clear();
            if (typeof tileStore.clear === 'function') tileStore.clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        return;
    }

    // 3. Pre-calculate integer tile bounds per zoom level (1..15) ONLY for overlapping remaining maps
    const deletingBbox = deletingMap?.pins ? getPinsBoundingBox(deletingMap.pins) : null;
    const overlappingOtherMaps = otherMaps.filter(map => {
        if (!map.pins || map.pins.length === 0) return false;
        if (!deletingBbox) return true; // If deleting map bbox is unknown, assume potential overlap
        const otherBbox = getPinsBoundingBox(map.pins);
        if (!otherBbox) return false;

        const isDisjoint = (
            deletingBbox.south > otherBbox.north ||
            deletingBbox.north < otherBbox.south ||
            deletingBbox.west > otherBbox.east ||
            deletingBbox.east < otherBbox.west
        );
        return !isDisjoint;
    });

    interface PrecomputedMapRange {
        mapId: string;
        rangesByZoom: Array<Array<{ xStart: number; xEnd: number; yStart: number; yEnd: number }>>;
    }

    const remainingRanges: PrecomputedMapRange[] = [];
    if (overlappingOtherMaps.length > 0) {
        for (const map of overlappingOtherMaps) {
            if (!map.pins || map.pins.length === 0) continue;
            const bbox = getPinsBoundingBox(map.pins);
            if (!bbox) continue;

            const rangesByZoom: Array<Array<{ xStart: number; xEnd: number; yStart: number; yEnd: number }>> = [];
            for (let z = 0; z <= 15; z++) {
                if (z === 0) {
                    rangesByZoom[0] = [];
                    continue;
                }
                if (z <= 4) {
                    const maxTile = (1 << z) - 1;
                    rangesByZoom[z] = [{ xStart: 0, xEnd: maxTile, yStart: 0, yEnd: maxTile }];
                    continue;
                }
                const buffer = (z >= 5 && z <= 8) ? 2 : (z === 9 ? 1 : 0);
                const [yStart, yEnd] = getYRange(bbox.north, bbox.south, z, buffer);
                const xRanges = getXRanges(bbox.west, bbox.east, z, buffer);
                rangesByZoom[z] = xRanges.map(([xStart, xEnd]) => ({
                    xStart, xEnd, yStart, yEnd
                }));
            }
            remainingRanges.push({ mapId: map.id, rangesByZoom });
        }
    }

    const isTileNeededByRemaining = (entry: ManifestEntry): string | null => {
        if (remainingRanges.length === 0) return null;
        const z = entry.z;
        if (z < 1 || z > 15) return null;
        const x = entry.x;
        const y = entry.y;
        for (const { mapId: remainingId, rangesByZoom } of remainingRanges) {
            const zoomRanges = rangesByZoom[z];
            if (zoomRanges) {
                for (const range of zoomRanges) {
                    if (x >= range.xStart && x <= range.xEnd && y >= range.yStart && y <= range.yEnd) {
                        return remainingId;
                    }
                }
            }
        }
        return null;
    };

    // 4. Fetch all manifest entries for mapId
    const entries = await new Promise<ManifestEntry[]>((resolve, reject) => {
        const tx = db.transaction(MANIFEST_STORE, 'readonly');
        const manifestStore = tx.objectStore(MANIFEST_STORE);
        const index = manifestStore.index('mapId');
        const req = index.getAll(keyRangeOnly(mapId));
        req.onsuccess = () => resolve((req.result as ManifestEntry[]) || []);
        req.onerror = () => reject(req.error);
    });

    if (entries.length === 0) return;

    // 5. Process deletions in fast batched transactions (BATCH_SIZE = 5,000)
    const BATCH_SIZE = 5000;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const chunk = entries.slice(i, i + BATCH_SIZE);
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([MANIFEST_STORE, TILE_STORE], 'readwrite');
            const manifestStore = tx.objectStore(MANIFEST_STORE);
            const tileStore = tx.objectStore(TILE_STORE);

            for (const entry of chunk) {
                const remainingOwnerId = isTileNeededByRemaining(entry);
                if (!remainingOwnerId) {
                    const canonicalKey = toCanonicalTileKey(entry.url);
                    tileStore.delete(canonicalKey);
                    if (entry.url !== canonicalKey) {
                        tileStore.delete(entry.url);
                    }
                    manifestStore.delete(entry.url);
                } else {
                    entry.mapId = remainingOwnerId;
                    manifestStore.put(entry);
                }
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
        });
    }
}

export function toCanonicalTileKey(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        const slashIdx = url.indexOf('/', url.indexOf('//') + 2);
        return slashIdx !== -1 ? url.slice(slashIdx) : url;
    }
    return url;
}

export function getTileKeys(url: string): { primary: string; secondary?: string } {
    const canonical = toCanonicalTileKey(url);
    if (url === canonical) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        return origin ? { primary: canonical, secondary: `${origin}${canonical}` } : { primary: canonical };
    }
    return { primary: canonical, secondary: url };
}

export interface TileBatchItem {
    url: string;
    data?: Uint8Array | ArrayBuffer | Blob | null;
    /** @deprecated alias for data */
    blob?: Uint8Array | ArrayBuffer | Blob | null;
    status: TileStatus;
    entry?: ManifestEntry;
}

export async function saveTileBatch(items: TileBatchItem[]): Promise<void> {
    if (!items || items.length === 0) return;
    if (tileMissCache.size > 0) {
        for (const item of items) {
            const { primary, secondary } = getTileKeys(item.url);
            tileMissCache.delete(primary);
            if (secondary) tileMissCache.delete(secondary);
        }
    }

    const db = await openDB();
    const transaction = db.transaction([TILE_STORE, MANIFEST_STORE], 'readwrite');
    const tileStore = transaction.objectStore(TILE_STORE);
    const manifestStore = transaction.objectStore(MANIFEST_STORE);
    const now = Date.now();

    for (const item of items) {
        const rawData = item.data !== undefined ? item.data : item.blob;
        if (rawData) {
            let uint8: Uint8Array;
            if (rawData instanceof Uint8Array) {
                uint8 = rawData;
            } else if (rawData instanceof ArrayBuffer) {
                uint8 = new Uint8Array(rawData);
            } else if (rawData instanceof Blob) {
                uint8 = new Uint8Array(await rawData.arrayBuffer());
            } else {
                uint8 = new Uint8Array(0);
            }
            const canonicalKey = toCanonicalTileKey(item.url);
            tileStore.put(uint8, canonicalKey);
            recordTileHit(canonicalKey, uint8);
        }

        if (item.entry) {
            item.entry.status = item.status;
            item.entry.updatedAt = now;
            manifestStore.put(item.entry);
        } else {
            const getReq = manifestStore.get(item.url);
            getReq.onsuccess = () => {
                const entry = getReq.result as ManifestEntry;
                if (entry) {
                    entry.status = item.status;
                    entry.updatedAt = now;
                    manifestStore.put(entry);
                }
            };
        }
    }

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
}

export async function saveTile(url: string, data: Uint8Array | ArrayBuffer | Blob): Promise<void> {
    const { primary, secondary } = getTileKeys(url);
    tileMissCache.delete(primary);
    if (secondary) tileMissCache.delete(secondary);

    const canonicalKey = toCanonicalTileKey(url);
    let uint8: Uint8Array;
    if (data instanceof Uint8Array) {
        uint8 = data;
    } else if (data instanceof ArrayBuffer) {
        uint8 = new Uint8Array(data);
    } else if (data instanceof Blob) {
        uint8 = new Uint8Array(await data.arrayBuffer());
    } else {
        uint8 = new Uint8Array(0);
    }

    recordTileHit(canonicalKey, uint8);
    if (secondary) recordTileHit(secondary, uint8);

    const db = await openDB();
    const transaction = db.transaction([TILE_STORE, MANIFEST_STORE], 'readwrite');
    
    const tileStore = transaction.objectStore(TILE_STORE);
    tileStore.put(uint8, canonicalKey);

    const manifestStore = transaction.objectStore(MANIFEST_STORE);
    const getReq = manifestStore.get(url);
    getReq.onsuccess = () => {
        const entry = getReq.result as ManifestEntry;
        if (entry) {
            entry.status = 'completed';
            entry.updatedAt = Date.now();
            manifestStore.put(entry);
        }
    };

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

export async function getTile(url: string): Promise<Uint8Array | null> {
    const { primary, secondary } = getTileKeys(url);
    const hit = getCachedTile(primary) || (secondary ? getCachedTile(secondary) : null);
    if (hit) {
        return hit;
    }
    if (tileMissCache.has(primary) || (secondary && tileMissCache.has(secondary))) {
        return null;
    }
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(TILE_STORE, 'readonly');
            const store = transaction.objectStore(TILE_STORE);
            const request = store.get(primary);
            request.onsuccess = () => {
                const res = request.result;
                if (res) {
                    const data = res instanceof Uint8Array ? res : (res instanceof ArrayBuffer ? new Uint8Array(res) : res);
                    recordTileHit(primary, data);
                    if (secondary) recordTileHit(secondary, data);
                    resolve(data);
                    return;
                }
                if (secondary) {
                    const secReq = store.get(secondary);
                    secReq.onsuccess = () => {
                        const secRes = secReq.result;
                        if (secRes) {
                            const data = secRes instanceof Uint8Array ? secRes : (secRes instanceof ArrayBuffer ? new Uint8Array(secRes) : secRes);
                            recordTileHit(primary, data);
                            recordTileHit(secondary, data);
                            resolve(data);
                        } else {
                            recordTileMiss(primary);
                            recordTileMiss(secondary);
                            resolve(null);
                        }
                    };
                    secReq.onerror = () => {
                        recordTileMiss(primary);
                        recordTileMiss(secondary);
                        resolve(null);
                    };
                } else {
                    recordTileMiss(primary);
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return null;
    }
}

export async function prewarmTilesForArea(box: BoundingBox, zoom: number): Promise<void> {
    if (!box || typeof indexedDB === 'undefined') return;
    try {
        const z = Math.max(1, Math.min(15, Math.round(zoom)));
        const yMin = latToY(box.north, z);
        const yMax = latToY(box.south, z);
        const yStart = Math.min(yMin, yMax);
        const yEnd = Math.max(yMin, yMax);
        const xRanges = getXRanges(box.west, box.east, z);

        const keysToFetch: string[] = [];
        for (const [xStart, xEnd] of xRanges) {
            for (let x = xStart; x <= xEnd; x++) {
                for (let y = yStart; y <= yEnd; y++) {
                    const key = `/maps/tile/${z}/${x}/${y}.mvt`;
                    if (!tileHitCache.has(key) && !tileMissCache.has(key)) {
                        keysToFetch.push(key);
                        if (keysToFetch.length >= 36) break;
                    }
                }
                if (keysToFetch.length >= 36) break;
            }
            if (keysToFetch.length >= 36) break;
        }

        if (keysToFetch.length === 0) return;

        const db = await openDB();
        await new Promise<void>((resolve) => {
            const tx = db.transaction(TILE_STORE, 'readonly');
            const store = tx.objectStore(TILE_STORE);
            let remaining = keysToFetch.length;
            for (const key of keysToFetch) {
                const req = store.get(key);
                req.onsuccess = () => {
                    const res = req.result;
                    if (res) {
                        const data = res instanceof Uint8Array ? res : (res instanceof ArrayBuffer ? new Uint8Array(res) : res);
                        recordTileHit(key, data);
                    }
                    remaining--;
                    if (remaining === 0) resolve();
                };
                req.onerror = () => {
                    remaining--;
                    if (remaining === 0) resolve();
                };
            }
            tx.onabort = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch {
        // ignore prewarm errors
    }
}

export function getXRanges(west: number, east: number, zoom: number, buffer = 0): Array<[number, number]> {
    const maxTile = (1 << zoom) - 1;
    const rawXMin = longToX(west, zoom) - buffer;
    const rawXMax = longToX(east, zoom) + buffer;
    if (west <= east) {
        const xMin = Math.max(0, Math.min(maxTile, Math.min(rawXMin, rawXMax)));
        const xMax = Math.max(0, Math.min(maxTile, Math.max(rawXMin, rawXMax)));
        return [[xMin, xMax]];
    } else {
        // Crossing the antimeridian (180th meridian)
        const xMin = Math.max(0, Math.min(maxTile, rawXMin));
        const xMax = Math.max(0, Math.min(maxTile, rawXMax));
        return [
            [xMin, maxTile],
            [0, xMax]
        ];
    }
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


export async function getPendingFromTileList(tiles: TileInfo[], mapId: string): Promise<TileInfo[]> {
    if (!tiles || tiles.length === 0) return [];
    if (typeof indexedDB === 'undefined') return tiles;
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(MANIFEST_STORE, 'readonly');
            const store = transaction.objectStore(MANIFEST_STORE);
            if (!store.indexNames || !store.indexNames.contains('mapId_status')) {
                resolve(tiles);
                return;
            }
            const index = store.index('mapId_status');
            const req = typeof index.getAllKeys === 'function'
                ? index.getAllKeys(keyRangeOnly([mapId, 'completed'] as any))
                : index.getAll(keyRangeOnly([mapId, 'completed'] as any));

            req.onsuccess = () => {
                const res = (req.result as any[]) || [];
                const completedUrls = new Set<string>(
                    res.map(item => (typeof item === 'string' ? item : item?.url))
                );
                if (completedUrls.size === 0) {
                    resolve(tiles);
                    return;
                }
                resolve(tiles.filter(t => !completedUrls.has(t.url)));
            };
            req.onerror = () => resolve(tiles);
        });
    } catch {
        return tiles;
    }
}

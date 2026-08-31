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
const DB_VERSION = 3;

function keyRangeOnly(key: string): any {
    return typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.only(key) : key;
}

let dbPromise: Promise<IDBDatabase> | null = null;
const tileMissCache = new Set<string>();
const MAX_MISS_CACHE_SIZE = 10000;

export function clearTileMissCache(): void {
    tileMissCache.clear();
}

function recordTileMiss(url: string): void {
    if (tileMissCache.size >= MAX_MISS_CACHE_SIZE) {
        tileMissCache.clear();
    }
    tileMissCache.add(url);
}

export function resetDBForTesting(): void {
    dbPromise = null;
    tileMissCache.clear();
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
                let manifest: IDBObjectStore;
                if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
                    manifest = db.createObjectStore(MANIFEST_STORE, { keyPath: 'url' });
                    manifest.createIndex('status', 'status', { unique: false });
                    manifest.createIndex('mapId', 'mapId', { unique: false });
                } else if (event?.target?.transaction) {
                    manifest = event.target.transaction.objectStore(MANIFEST_STORE);
                } else {
                    manifest = (request as any).transaction?.objectStore(MANIFEST_STORE);
                }
                if (manifest && !manifest.indexNames.contains('mapId_status')) {
                    manifest.createIndex('mapId_status', ['mapId', 'status'], { unique: false });
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

export async function addToManifest(entries: ManifestEntry[]): Promise<void> {
    if (!entries || entries.length === 0) return;
    const db = await openDB();
    const CHUNK_SIZE = 1000;

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
                        }
                    };
                }
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
        });
    }
}


export async function getPendingFromManifest(mapId: string): Promise<ManifestEntry[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MANIFEST_STORE, 'readonly');
        const store = transaction.objectStore(MANIFEST_STORE);
        const index = store.index('mapId');
        const request = index.getAll(keyRangeOnly(mapId));

        request.onsuccess = () => {
            const all = request.result as ManifestEntry[];
            resolve(all.filter(e => e.status === 'pending' || e.status === 'error'));
        };
        request.onerror = () => reject(request.error);
    });
}

export async function getManifestStats(mapId: string): Promise<{ total: number, completed: number }> {
    if (!mapId || typeof indexedDB === 'undefined') return { total: 0, completed: 0 };
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(MANIFEST_STORE, 'readonly');
            const store = transaction.objectStore(MANIFEST_STORE);
            const index = store.index('mapId');

            if (store.indexNames && store.indexNames.contains('mapId_status')) {
                const compoundIndex = store.index('mapId_status');
                const totalReq = index.count(keyRangeOnly(mapId));
                const completedReq = compoundIndex.count(keyRangeOnly([mapId, 'completed'] as any));

                let total: number | null = null;
                let completed: number | null = null;

                const checkDone = () => {
                    if (total !== null && completed !== null) {
                        resolve({ total, completed });
                    }
                };

                totalReq.onsuccess = () => {
                    total = totalReq.result || 0;
                    checkDone();
                };
                totalReq.onerror = () => reject(totalReq.error);

                completedReq.onsuccess = () => {
                    completed = completedReq.result || 0;
                    checkDone();
                };
                completedReq.onerror = () => reject(completedReq.error);
                return;
            }

            const request = index.getAll(keyRangeOnly(mapId));

            request.onsuccess = () => {
                const all = request.result as ManifestEntry[];
                const completed = all.filter(e => e.status === 'completed').length;
                resolve({ total: all.length, completed });
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return { total: 0, completed: 0 };
    }
}

export async function getManifestEntries(mapId: string): Promise<ManifestEntry[]> {
    if (!mapId || typeof indexedDB === 'undefined') return [];
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(MANIFEST_STORE, 'readonly');
            const store = transaction.objectStore(MANIFEST_STORE);
            const index = store.index('mapId');
            const request = index.getAll(keyRangeOnly(mapId));

            request.onsuccess = () => resolve(request.result as ManifestEntry[]);
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

export async function getMapDownloadStatuses(mapIds?: string[]): Promise<Map<string, MapDownloadStatus>> {
    if (typeof indexedDB === 'undefined') return new Map();
    try {
        const db = await openDB();
        const resultMap = new Map<string, MapDownloadStatus>();

        return new Promise((resolve, reject) => {
            const hasMapIds = Array.isArray(mapIds) && mapIds.length > 0;
            const transaction = db.transaction([MANIFEST_STORE, MAP_STORE], 'readonly');
            const manifestStore = transaction.objectStore(MANIFEST_STORE);
            const mapStore = transaction.objectStore(MAP_STORE);
            const compoundIndex = manifestStore.indexNames.contains('mapId_status') ? manifestStore.index('mapId_status') : null;
            const mapIdIndex = manifestStore.indexNames.contains('mapId') ? manifestStore.index('mapId') : null;

            const processMapIdList = (targetIds: string[]) => {
                if (targetIds.length === 0) {
                    resolve(resultMap);
                    return;
                }

                let pendingCount = targetIds.length;
                targetIds.forEach(mapId => {
                    const mapGetReq = mapStore.get(mapId);
                    let hasOfflineMapRecord = false;

                    const runManifestCheck = () => {
                        if (mapIdIndex && compoundIndex) {
                            const totalReq = mapIdIndex.count(keyRangeOnly(mapId));
                            const completedReq = compoundIndex.count(keyRangeOnly([mapId, 'completed'] as any));

                            let total: number | null = null;
                            let completed: number | null = null;

                            const checkDone = () => {
                                if (total !== null && completed !== null) {
                                    if (total > 0) {
                                        resultMap.set(mapId, {
                                            isComplete: completed === total,
                                            isPartial: completed > 0 && completed < total
                                        });
                                    } else if (hasOfflineMapRecord) {
                                        // Map is saved offline and all shared tiles are already cached
                                        resultMap.set(mapId, {
                                            isComplete: true,
                                            isPartial: false
                                        });
                                    }
                                    pendingCount--;
                                    if (pendingCount === 0) {
                                        resolve(resultMap);
                                    }
                                }
                            };

                            totalReq.onsuccess = () => {
                                total = totalReq.result || 0;
                                checkDone();
                            };
                            totalReq.onerror = () => reject(totalReq.error);

                            completedReq.onsuccess = () => {
                                completed = completedReq.result || 0;
                                checkDone();
                            };
                            completedReq.onerror = () => reject(completedReq.error);
                        } else {
                            const req = mapIdIndex ? mapIdIndex.openCursor(keyRangeOnly(mapId)) : manifestStore.openCursor();
                            let total = 0;
                            let completed = 0;
                            req.onsuccess = (e: any) => {
                                const cursor = (e && e.target) ? e.target.result : (req ? req.result : null);
                                if (cursor) {
                                    total++;
                                    if (cursor.value?.status === 'completed') completed++;
                                    cursor.continue();
                                } else {
                                    if (total > 0) {
                                        resultMap.set(mapId, {
                                            isComplete: completed === total,
                                            isPartial: completed > 0 && completed < total
                                        });
                                    } else if (hasOfflineMapRecord) {
                                        resultMap.set(mapId, {
                                            isComplete: true,
                                            isPartial: false
                                        });
                                    }
                                    pendingCount--;
                                    if (pendingCount === 0) {
                                        resolve(resultMap);
                                    }
                                }
                            };
                            req.onerror = () => reject(req.error);
                        }
                    };

                    mapGetReq.onsuccess = () => {
                        hasOfflineMapRecord = Boolean(mapGetReq.result);
                        runManifestCheck();
                    };
                    mapGetReq.onerror = () => {
                        hasOfflineMapRecord = false;
                        runManifestCheck();
                    };
                });
            };

            if (hasMapIds) {
                processMapIdList(mapIds!);
            } else {
                const mapKeysReq = mapStore.getAllKeys();
                mapKeysReq.onsuccess = () => {
                    const discoveredIds = (mapKeysReq.result as string[]) || [];
                    if (discoveredIds.length > 0) {
                        processMapIdList(discoveredIds);
                    } else if (typeof manifestStore.getAll === 'function') {
                        const allReq = manifestStore.getAll();
                        allReq.onsuccess = () => {
                            const allEntries = (allReq.result as ManifestEntry[]) || [];
                            const uniqueIds = Array.from(new Set(allEntries.map(entry => entry.mapId).filter((id): id is string => Boolean(id))));
                            processMapIdList(uniqueIds);
                        };
                        allReq.onerror = () => reject(allReq.error);
                    } else {
                        resolve(resultMap);
                    }
                };
                mapKeysReq.onerror = () => reject(mapKeysReq.error);
            }
        });
    } catch {
        return new Map();
    }
}

export async function isMapDownloaded(mapId: string): Promise<boolean> {
    if (!mapId || typeof indexedDB === 'undefined') return false;
    try {
        const offlineMap = await getOfflineMap(mapId);
        if (offlineMap) return true;
        const { total, completed } = await getManifestStats(mapId);
        return total > 0 && completed > 0;
    } catch {
        return false;
    }
}

export async function removeMapDownload(mapId: string): Promise<void> {
    if (!mapId) return;
    clearTileMissCache();
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([MANIFEST_STORE, TILE_STORE, MAP_STORE], 'readwrite');
        const manifestStore = transaction.objectStore(MANIFEST_STORE);
        const tileStore = transaction.objectStore(TILE_STORE);
        const mapStore = transaction.objectStore(MAP_STORE);

        mapStore.delete(mapId);

        const otherMapsReq = mapStore.getAll();
        otherMapsReq.onsuccess = () => {
            const otherMaps = (otherMapsReq.result as MapData[]) || [];

            // If no other offline maps remain, cleanly clear all stored tile data
            if (otherMaps.length === 0) {
                if (typeof manifestStore.clear === 'function') {
                    manifestStore.clear();
                }
                if (typeof tileStore.clear === 'function') {
                    tileStore.clear();
                }
                return;
            }

            // Collect tile URLs required by remaining offline maps
            const neededUrls = new Set<string>();
            const tileOwnerMap = new Map<string, string>();

            otherMaps.forEach(map => {
                if (!map.pins) return;
                const bbox = getPinsBoundingBox(map.pins);
                if (bbox) {
                    const tiles = [
                        ...getTilesForArea(bbox, 1, 10),
                        ...getSurgicalBoxes(map.pins).flatMap(box => getTilesForArea(box, 11, 15))
                    ];
                    tiles.forEach(t => {
                        neededUrls.add(t.url);
                        if (!tileOwnerMap.has(t.url)) {
                            tileOwnerMap.set(t.url, map.id);
                        }
                    });
                }
            });

            const index = manifestStore.index('mapId');
            const request = index.getAll(keyRangeOnly(mapId));

            request.onsuccess = () => {
                const entries = request.result as ManifestEntry[];
                entries.forEach(entry => {
                    if (!neededUrls.has(entry.url)) {
                        const { primary, secondary } = getTileKeys(entry.url);
                        tileStore.delete(primary);
                        if (secondary) tileStore.delete(secondary);
                        manifestStore.delete(entry.url);
                    } else {
                        // Re-assign manifest entry to the remaining map that needs it
                        const newOwnerId = tileOwnerMap.get(entry.url);
                        if (newOwnerId) {
                            entry.mapId = newOwnerId;
                            manifestStore.put(entry);
                        }
                    }
                });
            };
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}


export function getTileKeys(url: string): { primary: string; secondary?: string } {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        try {
            const pathname = new URL(url).pathname;
            return { primary: url, secondary: pathname };
        } catch {
            return { primary: url };
        }
    } else if (url.startsWith('/')) {
        try {
            const fullUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${url}`;
            return { primary: url, secondary: fullUrl };
        } catch {
            return { primary: url };
        }
    }
    return { primary: url };
}

export interface TileBatchItem {
    url: string;
    blob?: Blob | null;
    status: TileStatus;
}

export async function saveTileBatch(items: TileBatchItem[]): Promise<void> {
    if (!items || items.length === 0) return;
    for (const item of items) {
        const { primary, secondary } = getTileKeys(item.url);
        tileMissCache.delete(primary);
        if (secondary) tileMissCache.delete(secondary);
    }

    const db = await openDB();
    const transaction = db.transaction([TILE_STORE, MANIFEST_STORE], 'readwrite');
    const tileStore = transaction.objectStore(TILE_STORE);
    const manifestStore = transaction.objectStore(MANIFEST_STORE);
    const now = Date.now();

    for (const item of items) {
        if (item.blob) {
            const { primary, secondary } = getTileKeys(item.url);
            tileStore.put(item.blob, primary);
            if (secondary) {
                tileStore.put(item.blob, secondary);
            }
        }

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

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
}

export async function saveTile(url: string, blob: Blob): Promise<void> {
    const { primary, secondary } = getTileKeys(url);
    tileMissCache.delete(primary);
    if (secondary) tileMissCache.delete(secondary);

    const db = await openDB();
    const transaction = db.transaction([TILE_STORE, MANIFEST_STORE], 'readwrite');
    
    const tileStore = transaction.objectStore(TILE_STORE);
    tileStore.put(blob, primary);
    if (secondary) {
        tileStore.put(blob, secondary);
    }

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

export async function getTile(url: string): Promise<Blob | null> {
    const { primary, secondary } = getTileKeys(url);
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
                if (request.result) {
                    resolve(request.result);
                    return;
                }
                if (secondary) {
                    const secReq = store.get(secondary);
                    secReq.onsuccess = () => {
                        if (secReq.result) {
                            resolve(secReq.result);
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

export function countTiles(box: BoundingBox, minZoom: number, maxZoom: number): number {
    let count = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
        const xMin = longToX(box.west, z);
        const xMax = longToX(box.east, z);
        const yMin = latToY(box.north, z);
        const yMax = latToY(box.south, z);
        
        const width = Math.abs(xMax - xMin) + 1;
        const height = Math.abs(yMax - yMin) + 1;
        count += (width * height);
    }
    return count;
}

export function estimateSizeMB(tileCount: number): number {
    return (tileCount * 20.0) / 1024.0;
}

function longToX(lon: number, zoom: number): number {
    const x = Math.floor((lon + 180.0) / 360.0 * (1 << zoom));
    return ((x % (1 << zoom)) + (1 << zoom)) % (1 << zoom);
}

function latToY(lat: number, zoom: number): number {
    const latRad = lat * Math.PI / 180.0;
    const y = Math.floor((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0 * (1 << zoom));
    return Math.max(0, Math.min((1 << zoom) - 1, y));
}

export function getTilesForArea(box: BoundingBox, minZoom: number, maxZoom: number): TileInfo[] {
    const tiles: TileInfo[] = [];
    const origin = typeof window !== 'undefined' 
        ? window.location.origin 
        : (typeof self !== 'undefined' && self.location ? self.location.origin : '');

    for (let z = minZoom; z <= maxZoom; z++) {
        const xMin = longToX(box.west, z);
        const xMax = longToX(box.east, z);
        const yMin = latToY(box.north, z);
        const yMax = latToY(box.south, z);

        const xStart = Math.min(xMin, xMax);
        const xEnd = Math.max(xMin, xMax);
        const yStart = Math.min(yMin, yMax);
        const yEnd = Math.max(yMin, yMax);

        for (let x = xStart; x <= xEnd; x++) {
            for (let y = yStart; y <= yEnd; y++) {
                tiles.push({
                    x, y, z,
                    url: `${origin}/maps/tile/${z}/${x}/${y}.mvt`
                });
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
            north: Math.min(85, p.lat + 0.06),
            south: Math.max(-85, p.lat - 0.06),
            east: Math.min(180, p.lng + 0.06),
            west: Math.max(-180, p.lng - 0.06)
        };
    }

    pins.forEach(pin => {
        if (pin.lat > north) north = pin.lat;
        if (pin.lat < south) south = pin.lat;
        if (pin.lng > east) east = pin.lng;
        if (pin.lng < west) west = pin.lng;
    });

    return {
        north: Math.min(85, north + 0.05),
        south: Math.max(-85, south - 0.05),
        east: Math.min(180, east + 0.05),
        west: Math.max(-180, west - 0.05)
    };
}

export function countUniqueTiles(bbox: BoundingBox, surgicalBoxes: BoundingBox[] = []): number {
    const tileKeys = new Set<string>();

    for (let z = 1; z <= 10; z++) {
        const xMin = longToX(bbox.west, z);
        const xMax = longToX(bbox.east, z);
        const yMin = latToY(bbox.north, z);
        const yMax = latToY(bbox.south, z);
        const xStart = Math.min(xMin, xMax);
        const xEnd = Math.max(xMin, xMax);
        const yStart = Math.min(yMin, yMax);
        const yEnd = Math.max(yMin, yMax);

        for (let x = xStart; x <= xEnd; x++) {
            for (let y = yStart; y <= yEnd; y++) {
                tileKeys.add(`${z}/${x}/${y}`);
            }
        }
    }

    for (const box of surgicalBoxes) {
        for (let z = 11; z <= 15; z++) {
            const xMin = longToX(box.west, z);
            const xMax = longToX(box.east, z);
            const yMin = latToY(box.north, z);
            const yMax = latToY(box.south, z);
            const xStart = Math.min(xMin, xMax);
            const xEnd = Math.max(xMin, xMax);
            const yStart = Math.min(yMin, yMax);
            const yEnd = Math.max(yMin, yMax);

            for (let x = xStart; x <= xEnd; x++) {
                for (let y = yStart; y <= yEnd; y++) {
                    tileKeys.add(`${z}/${x}/${y}`);
                }
            }
        }
    }

    return tileKeys.size;
}

export function getSurgicalBoxes(pins: Pin[]): BoundingBox[] {
    if (!pins || pins.length === 0) return [];
    
    let boxes: BoundingBox[] = pins.map(pin => ({
        north: pin.lat + 0.01,
        east: pin.lng + 0.01,
        south: pin.lat - 0.01,
        west: pin.lng - 0.01
    }));

    let mergedAny = true;
    while (mergedAny) {
        mergedAny = false;
        const nextBoxes: BoundingBox[] = [];

        for (const box of boxes) {
            let merged = false;
            for (let i = 0; i < nextBoxes.length; i++) {
                if (shouldMerge(nextBoxes[i], box)) {
                    nextBoxes[i] = mergeBoxes(nextBoxes[i], box);
                    merged = true;
                    mergedAny = true;
                    break;
                }
            }
            if (!merged) {
                nextBoxes.push(box);
            }
        }
        boxes = nextBoxes;
    }

    return boxes;
}

function shouldMerge(b1: BoundingBox, b2: BoundingBox, threshold = 0.025): boolean {
    return !(
        b1.west - threshold > b2.east ||
        b1.east + threshold < b2.west ||
        b1.north + threshold < b2.south ||
        b1.south - threshold > b2.north
    );
}

function mergeBoxes(b1: BoundingBox, b2: BoundingBox): BoundingBox {
    return {
        north: Math.max(b1.north, b2.north),
        east: Math.max(b1.east, b2.east),
        south: Math.min(b1.south, b2.south),
        west: Math.min(b1.west, b2.west)
    };
}

export async function updateManifestStatus(url: string, status: TileStatus): Promise<void> {
    const db = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction(MANIFEST_STORE, 'readwrite');
        const store = transaction.objectStore(MANIFEST_STORE);
        const getReq = store.get(url);
        getReq.onsuccess = () => {
            const entry = getReq.result as ManifestEntry;
            if (entry) {
                entry.status = status;
                entry.updatedAt = Date.now();
                store.put(entry);
            }
            resolve();
        };
        requestIdleCallback(() => resolve()); // Fallback
    });
}

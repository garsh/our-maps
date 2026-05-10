import type { Pin } from '@shared/interfaces';

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
const DB_VERSION = 1;

async function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
                const manifest = db.createObjectStore(MANIFEST_STORE, { keyPath: 'url' });
                manifest.createIndex('status', 'status', { unique: false });
                manifest.createIndex('mapId', 'mapId', { unique: false });
            }
            if (!db.objectStoreNames.contains(TILE_STORE)) {
                db.createObjectStore(TILE_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function addToManifest(entries: ManifestEntry[]): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MANIFEST_STORE, 'readwrite');
        const store = transaction.objectStore(MANIFEST_STORE);
        
        entries.forEach(entry => {
            store.put(entry);
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

export async function getPendingFromManifest(mapId: string): Promise<ManifestEntry[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MANIFEST_STORE, 'readonly');
        const store = transaction.objectStore(MANIFEST_STORE);
        const index = store.index('mapId');
        const request = index.getAll(IDBKeyRange.only(mapId));

        request.onsuccess = () => {
            const all = request.result as ManifestEntry[];
            resolve(all.filter(e => e.status === 'pending' || e.status === 'error'));
        };
        request.onerror = () => reject(request.error);
    });
}

export async function getManifestStats(mapId: string): Promise<{ total: number, completed: number }> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MANIFEST_STORE, 'readonly');
        const store = transaction.objectStore(MANIFEST_STORE);
        const index = store.index('mapId');
        const request = index.getAll(IDBKeyRange.only(mapId));

        request.onsuccess = () => {
            const all = request.result as ManifestEntry[];
            const completed = all.filter(e => e.status === 'completed').length;
            resolve({ total: all.length, completed });
        };
        request.onerror = () => reject(request.error);
    });
}

export async function saveTile(url: string, blob: Blob): Promise<void> {
    const db = await openDB();
    const transaction = db.transaction([TILE_STORE, MANIFEST_STORE], 'readwrite');
    
    const tileStore = transaction.objectStore(TILE_STORE);
    tileStore.put(blob, url);

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
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(TILE_STORE, 'readonly');
        const store = transaction.objectStore(TILE_STORE);
        const request = store.get(url);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
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
    const subdomains = ['a', 'b', 'c'];
    
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
                const s = subdomains[(x + y) % subdomains.length];
                tiles.push({
                    x, y, z,
                    url: `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`
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

export function getSurgicalBoxes(pins: Pin[]): BoundingBox[] {
    const highDetailBoxes: BoundingBox[] = [];
    
    pins.forEach(pin => {
        const newBox: BoundingBox = {
            north: pin.lat + 0.01,
            east: pin.lng + 0.01,
            south: pin.lat - 0.01,
            west: pin.lng - 0.01
        };
        
        let merged = false;
        for (let i = 0; i < highDetailBoxes.length; i++) {
            if (shouldMerge(highDetailBoxes[i], newBox)) {
                highDetailBoxes[i] = mergeBoxes(highDetailBoxes[i], newBox);
                merged = true;
                break;
            }
        }
        if (!merged) highDetailBoxes.push(newBox);
    });

    return highDetailBoxes;
}

function shouldMerge(b1: BoundingBox, b2: BoundingBox): boolean {
    const overlap = !(b1.west > b2.east || b1.east < b2.west || b1.north < b2.south || b1.south > b2.north);
    if (overlap) return true;
    const center1 = { lat: (b1.north + b1.south) / 2, lng: (b1.east + b1.west) / 2 };
    const center2 = { lat: (b2.north + b2.south) / 2, lng: (b2.east + b2.west) / 2 };
    const dist = Math.sqrt(Math.pow(center1.lat - center2.lat, 2) + Math.pow(center1.lng - center2.lng, 2));
    return dist < 0.05;
}

function mergeBoxes(b1: BoundingBox, b2: BoundingBox): BoundingBox {
    return {
        north: Math.max(b1.north, b2.north),
        east: Math.max(b1.east, b2.east),
        south: Math.min(b1.south, b2.south),
        west: Math.min(b1.west, b2.west)
    };
}

export async function downloadTiles(
    mapId: string,
    tiles: TileInfo[], 
    onProgress: (progress: number) => void
): Promise<void> {
    // 1. Add all to manifest if not present
    const entries: ManifestEntry[] = tiles.map(t => ({
        ...t,
        status: 'pending',
        mapId,
        updatedAt: Date.now()
    }));
    await addToManifest(entries);

    // 2. Get pending items (resumable)
    const pending = await getPendingFromManifest(mapId);
    if (pending.length === 0) {
        onProgress(1.0);
        return;
    }

    let completedCount = tiles.length - pending.length;
    const total = tiles.length;
    
    // 3. Worker Pool
    const CONCURRENCY = 15; // Pro-grade concurrency
    const queue = [...pending];
    
    const workers = Array(CONCURRENCY).fill(null).map(async () => {
        while (queue.length > 0) {
            const entry = queue.shift();
            if (!entry) break;

            try {
                const response = await fetch(entry.url);
                if (response.ok) {
                    const blob = await response.blob();
                    await saveTile(entry.url, blob);
                } else {
                    // Update status to error for future retry
                    await updateManifestStatus(entry.url, 'error');
                }
            } catch (error) {
                console.error(`Failed to download tile ${entry.url}:`, error);
                await updateManifestStatus(entry.url, 'error');
            }

            completedCount++;
            onProgress(completedCount / total);
        }
    });

    await Promise.all(workers);
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

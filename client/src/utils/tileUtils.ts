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

/**
 * Estimates the number of tiles in a bounding box for a range of zoom levels.
 */
export function countTiles(box: BoundingBox, minZoom: number, maxZoom: number): number {
    let total = 0;
    for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
        const xMin = longToX(box.west, zoom);
        const xMax = longToX(box.east, zoom);
        const yMin = latToY(box.north, zoom);
        const yMax = latToY(box.south, zoom);
        
        total += (Math.abs(xMax - xMin) + 1) * (Math.abs(yMax - yMin) + 1);
    }
    return total;
}

/**
 * Estimates size in MB based on tile count (avg 20KB per tile).
 */
export function estimateSizeMB(tileCount: number): number {
    return (tileCount * 20.0) / 1024.0;
}

function longToX(lon: number, zoom: number): number {
    return Math.floor((lon + 180.0) / 360.0 * (1 << zoom));
}

function latToY(lat: number, zoom: number): number {
    const latRad = lat * Math.PI / 180.0;
    return Math.floor((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0 * (1 << zoom));
}

export function getTilesForArea(box: BoundingBox, minZoom: number, maxZoom: number): TileInfo[] {
    const tiles: TileInfo[] = [];
    const subdomains = ['a', 'b', 'c'];

    for (let z = minZoom; z <= maxZoom; z++) {
        const xMin = longToX(box.west, z);
        const xMax = longToX(box.east, z);
        const yMin = latToY(box.north, z);
        const yMax = latToY(box.south, z);

        for (let x = Math.min(xMin, xMax); x <= Math.max(xMin, xMax); x++) {
            for (let y = Math.min(yMin, yMax); y <= Math.max(yMin, yMax); y++) {
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

export async function downloadTiles(
    tiles: TileInfo[], 
    onProgress: (progress: number) => void
): Promise<void> {
    const cache = await caches.open('osm-tiles');
    let completed = 0;
    const total = tiles.length;
    let lastReportedProgress = -1;

    // Use a small pool of concurrent fetches to avoid overloading the network/server
    const CONCURRENCY = 5;
    const queue = [...tiles];
    
    const workers = Array(CONCURRENCY).fill(null).map(async () => {
        while (queue.length > 0) {
            const tile = queue.shift();
            if (!tile) break;

            try {
                // Check if already in cache
                const existing = await cache.match(tile.url);
                if (!existing) {
                    const response = await fetch(tile.url);
                    if (response.ok) {
                        await cache.put(tile.url, response);
                    }
                }
            } catch (error) {
                console.error(`Failed to download tile ${tile.url}:`, error);
            }

            completed++;
            const currentProgress = Math.floor((completed / total) * 100);
            if (currentProgress > lastReportedProgress) {
                lastReportedProgress = currentProgress;
                onProgress(completed / total);
            }
        }
    });

    await Promise.all(workers);
}

export function getPinsBoundingBox(pins: Pin[]): BoundingBox | null {
    if (pins.length === 0) return null;
    
    let north = -90;
    let south = 90;
    let east = -180;
    let west = 180;

    pins.forEach(pin => {
        if (pin.lat > north) north = pin.lat;
        if (pin.lat < south) south = pin.lat;
        if (pin.lng > east) east = pin.lng;
        if (pin.lng < west) west = pin.lng;
    });

    // Add a small buffer (approx 5km)
    return {
        north: Math.min(90, north + 0.05),
        south: Math.max(-90, south - 0.05),
        east: Math.min(180, east + 0.05),
        west: Math.max(-180, west - 0.05)
    };
}

export function getSurgicalBoxes(pins: Pin[]): BoundingBox[] {
    const highDetailBoxes: BoundingBox[] = [];
    
    pins.forEach(pin => {
        // approx 1km buffer around each pin
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
    const b1LatCenter = (b1.north + b1.south) / 2.0;
    const b1LonCenter = (b1.east + b1.west) / 2.0;
    const b2LatCenter = (b2.north + b2.south) / 2.0;
    const b2LonCenter = (b2.east + b2.west) / 2.0;
    
    const latCenterDist = Math.abs(b1LatCenter - b2LatCenter);
    const lngCenterDist = Math.abs(b1LonCenter - b2LonCenter);
    return latCenterDist < 0.02 && lngCenterDist < 0.02;
}

function mergeBoxes(b1: BoundingBox, b2: BoundingBox): BoundingBox {
    return {
        north: Math.max(b1.north, b2.north),
        east: Math.max(b1.east, b2.east),
        south: Math.min(b1.south, b2.south),
        west: Math.min(b1.west, b2.west)
    };
}

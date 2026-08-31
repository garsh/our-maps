import { addToManifest, getPendingFromManifest, saveTileBatch, getTilesForArea, getSurgicalBoxes, type TileBatchItem, type TileInfo, type BoundingBox } from '../utils/tileUtils';
import { PMTiles } from 'pmtiles';

let pmtilesInstance: PMTiles | null = null;

function getPMTilesInstance(): PMTiles {
    if (!pmtilesInstance) {
        const pmtilesUrl = `${self.location.origin}/maps/planet.pmtiles`;
        pmtilesInstance = new PMTiles(pmtilesUrl);
    }
    return pmtilesInstance;
}

self.onmessage = async (e) => {
    const { type, mapId, tiles, bbox, pins, totalTiles: requestedTotal } = e.data;

    if (type === 'start-download') {
        try {
            let tileEntries: TileInfo[] = [];
            if (Array.isArray(tiles) && tiles.length > 0) {
                tileEntries = tiles;
            } else if (bbox) {
                const boxes: Array<{ box: BoundingBox; minZ: number; maxZ: number }> = [
                    { box: bbox, minZ: 1, maxZ: 10 }
                ];
                if (Array.isArray(pins) && pins.length > 0) {
                    const surgical = getSurgicalBoxes(pins);
                    surgical.forEach(sBox => {
                        boxes.push({ box: sBox, minZ: 11, maxZ: 15 });
                    });
                }
                const seenUrls = new Set<string>();
                for (const { box, minZ, maxZ } of boxes) {
                    const generated = getTilesForArea(box, minZ, maxZ);
                    for (const t of generated) {
                        if (!seenUrls.has(t.url)) {
                            seenUrls.add(t.url);
                            tileEntries.push(t);
                        }
                    }
                }
            }

            // 1. Add to manifest
            await addToManifest(tileEntries.map((t: any) => ({
                status: 'pending',
                ...t,
                mapId,
                updatedAt: Date.now()
            })));

            // 2. Get resumable pending
            const pending = await getPendingFromManifest(mapId);
            const total = requestedTotal || tileEntries.length || pending.length;
            let completedCount = Math.max(0, total - pending.length);

            if (pending.length === 0) {
                self.postMessage({ type: 'progress', progress: 1.0 });
                self.postMessage({ type: 'complete' });
                return;
            }

            const pmt = getPMTilesInstance();
            try {
                await pmt.getHeader();
            } catch (err) {
                console.warn('[TILE WORKER] Pre-fetching PMTiles header failed:', err);
            }

            const CONCURRENCY = 6;
            const MAX_RETRIES = 3;
            const BATCH_SIZE = 50;
            let queueIndex = 0;
            let writeBuffer: TileBatchItem[] = [];

            const flushBuffer = async () => {
                if (writeBuffer.length === 0) return;
                const toWrite = writeBuffer;
                writeBuffer = [];
                await saveTileBatch(toWrite);
            };

            const queueTileWrite = async (item: TileBatchItem) => {
                writeBuffer.push(item);
                if (writeBuffer.length >= BATCH_SIZE) {
                    await flushBuffer();
                }
            };
            
            const workers = Array(CONCURRENCY).fill(null).map(async () => {
                while (queueIndex < pending.length) {
                    const entry = pending[queueIndex++];
                    if (!entry) break;

                    let success = false;
                    let retries = 0;

                    while (!success && retries < MAX_RETRIES) {
                        try {
                            const targetZoom = Math.min(entry.z, 15);
                            const tileResult = await pmt.getZxy(targetZoom, entry.x, entry.y);
                            if (tileResult && tileResult.data) {
                                const blob = new Blob([tileResult.data]);
                                await queueTileWrite({ url: entry.url, blob, status: 'completed' });
                            } else {
                                await queueTileWrite({ url: entry.url, status: 'completed' });
                            }
                            success = true;
                        } catch {
                            retries++;
                            if (retries < MAX_RETRIES) {
                                await new Promise(r => setTimeout(r, Math.pow(2, retries) * 250));
                            }
                        }
                    }

                    if (!success) {
                        await queueTileWrite({ url: entry.url, status: 'error' });
                    }

                    completedCount++;
                    if (completedCount % 5 === 0 || completedCount === total) {
                        self.postMessage({ 
                            type: 'progress', 
                            progress: completedCount / total,
                            completed: completedCount,
                            total
                        });
                    }
                }
            });

            await Promise.all(workers);
            await flushBuffer();
            self.postMessage({ type: 'complete', total });
        } catch (error: any) {
            self.postMessage({ type: 'error', error: error.message });
        }
    }
};

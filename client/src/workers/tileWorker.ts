import { getTilesForArea, getPendingFromTileList, saveTileBatch, removeMapDownload, type TileBatchItem, type TileInfo, type ManifestEntry } from '../utils/tileUtils';
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
    const { type, mapId, tiles, bbox, totalTiles: requestedTotal } = e.data;

    if (type === 'remove-download') {
        try {
            await removeMapDownload(mapId);
            self.postMessage({ type: 'remove-complete', mapId });
        } catch (error: any) {
            console.error('Error during removeMapDownload:', error);
            self.postMessage({ type: 'error', error: error.message });
        }
        return;
    }

    if (type === 'start-download') {
        try {
            const origin = self.location.origin;
            let tileEntries: TileInfo[] = [];
            if (Array.isArray(tiles) && tiles.length > 0) {
                tileEntries = tiles;
            } else if (bbox) {
                tileEntries = getTilesForArea(bbox, 1, 15);
            }

            const total = requestedTotal || tileEntries.length;
            const pending = await getPendingFromTileList(tileEntries, mapId);
            let completedCount = Math.max(0, total - pending.length);

            if (pending.length === 0) {
                self.postMessage({ type: 'progress', progress: 1.0, completed: total, total });
                self.postMessage({ type: 'complete', total });
                return;
            }

            const BATCH_SIZE = 1200;
            const progressStep = Math.max(1, Math.floor(total / 100));
            let writeBuffer: TileBatchItem[] = [];
            let flushPromise: Promise<void> | null = null;

            const flushBuffer = async () => {
                if (writeBuffer.length === 0) {
                    if (flushPromise) await flushPromise;
                    return;
                }
                const toWrite = writeBuffer;
                writeBuffer = [];

                const currentFlush = (async () => {
                    if (flushPromise) {
                        try { await flushPromise; } catch { /* ignore */ }
                    }
                    await saveTileBatch(toWrite);
                })();

                flushPromise = currentFlush;
                await currentFlush;
            };

            const queueTileWrite = async (item: TileBatchItem) => {
                writeBuffer.push(item);
                if (writeBuffer.length >= BATCH_SIZE) {
                    await flushBuffer();
                }
            };

            // Attempt high-speed server streaming endpoint if bbox is provided
            let streamedSuccessfully = false;
            if (bbox) {
                try {
                    const streamRes = await fetch(`${origin}/api/maps/tiles/stream`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ bbox, minZoom: 1, maxZoom: 15, mapId })
                    });

                    if (streamRes.ok && streamRes.body) {
                        const reader = streamRes.body.getReader();
                        let accumulated = new Uint8Array(0);
                        const now = Date.now();

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (!value || value.byteLength === 0) continue;

                            if (accumulated.byteLength === 0) {
                                accumulated = value;
                            } else {
                                const newAcc = new Uint8Array(accumulated.byteLength + value.byteLength);
                                newAcc.set(accumulated);
                                newAcc.set(value, accumulated.byteLength);
                                accumulated = newAcc;
                            }

                            let offset = 0;
                            const view = new DataView(accumulated.buffer, accumulated.byteOffset, accumulated.byteLength);

                            while (offset + 13 <= accumulated.byteLength) {
                                const z = view.getUint8(offset);
                                const x = view.getUint32(offset + 1, false);
                                const y = view.getUint32(offset + 5, false);
                                const dataLen = view.getUint32(offset + 9, false);

                                if (offset + 13 + dataLen > accumulated.byteLength) {
                                    break;
                                }

                                const url = `/maps/tile/${z}/${x}/${y}.mvt`;
                                const manifestEntry: ManifestEntry = {
                                    url,
                                    x,
                                    y,
                                    z,
                                    status: 'completed',
                                    mapId,
                                    updatedAt: now
                                };

                                if (dataLen > 0) {
                                    const tileData = accumulated.subarray(offset + 13, offset + 13 + dataLen);
                                    const data = new Uint8Array(tileData);
                                    await queueTileWrite({ url, data, status: 'completed', entry: manifestEntry });
                                } else {
                                    await queueTileWrite({ url, status: 'completed', entry: manifestEntry });
                                }

                                completedCount++;
                                if (completedCount % progressStep === 0 || completedCount === total) {
                                    self.postMessage({
                                        type: 'progress',
                                        progress: completedCount / total,
                                        completed: completedCount,
                                        total
                                    });
                                }

                                offset += (13 + dataLen);
                            }

                            if (offset > 0) {
                                accumulated = offset === accumulated.byteLength ? new Uint8Array(0) : accumulated.subarray(offset);
                            }
                        }

                        await flushBuffer();
                        streamedSuccessfully = true;
                    }
                } catch (streamErr) {
                    console.warn('[TILE WORKER] Server stream failed, falling back to client fetch:', streamErr);
                }
            }

            // Fallback to client-side concurrent PMTiles range requests if streaming was not used/failed
            if (!streamedSuccessfully) {
                const pmt = getPMTilesInstance();
                try {
                    await pmt.getHeader();
                } catch (err) {
                    console.warn('[TILE WORKER] Pre-fetching PMTiles header failed:', err);
                }

                const CONCURRENCY = 16;
                const MAX_RETRIES = 3;
                let queueIndex = 0;
                const now = Date.now();

                const workers = Array(CONCURRENCY).fill(null).map(async () => {
                    while (queueIndex < pending.length) {
                        const entry = pending[queueIndex++];
                        if (!entry) break;

                        let success = false;
                        let retries = 0;

                        const manifestEntry: ManifestEntry = {
                            url: entry.url,
                            x: entry.x,
                            y: entry.y,
                            z: entry.z,
                            status: 'completed',
                            mapId,
                            updatedAt: now
                        };

                        while (!success && retries < MAX_RETRIES) {
                            try {
                                const targetZoom = Math.min(entry.z, 15);
                                const tileResult = await pmt.getZxy(targetZoom, entry.x, entry.y);
                                if (tileResult && tileResult.data) {
                                    const data = new Uint8Array(tileResult.data);
                                    await queueTileWrite({ url: entry.url, data, status: 'completed', entry: manifestEntry });
                                } else {
                                    await queueTileWrite({ url: entry.url, status: 'completed', entry: manifestEntry });
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
                            manifestEntry.status = 'error';
                            await queueTileWrite({ url: entry.url, status: 'error', entry: manifestEntry });
                        }

                        completedCount++;
                        if (completedCount % progressStep === 0 || completedCount === total) {
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
            }

            self.postMessage({ type: 'complete', total });
        } catch (error: any) {
            self.postMessage({ type: 'error', error: error.message });
        }
    }
};

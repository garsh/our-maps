import { addToManifest, getPendingFromManifest, saveTile, updateManifestStatus } from '../utils/tileUtils';
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
    const { type, mapId, tiles } = e.data;

    if (type === 'start-download') {
        try {
            // 1. Add to manifest
            await addToManifest(tiles.map((t: any) => ({
                status: 'pending',
                ...t,
                mapId,
                updatedAt: Date.now()
            })));

            // 2. Get resumable pending
            const pending = await getPendingFromManifest(mapId);
            const total = tiles.length;
            let completedCount = total - pending.length;

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
            const queue = [...pending];
            
            const workers = Array(CONCURRENCY).fill(null).map(async () => {
                while (queue.length > 0) {
                    const entry = queue.shift();
                    if (!entry) break;

                    let success = false;
                    let retries = 0;

                    while (!success && retries < MAX_RETRIES) {
                        try {
                            const targetZoom = Math.min(entry.z, 15);
                            const tileResult = await pmt.getZxy(targetZoom, entry.x, entry.y);
                            if (tileResult && tileResult.data) {
                                const blob = new Blob([tileResult.data]);
                                await saveTile(entry.url, blob);
                            } else {
                                await updateManifestStatus(entry.url, 'completed');
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
                        await updateManifestStatus(entry.url, 'error');
                    }

                    completedCount++;
                    if (completedCount % 5 === 0 || completedCount === total) {
                        self.postMessage({ type: 'progress', progress: completedCount / total });
                    }
                }
            });

            await Promise.all(workers);
            self.postMessage({ type: 'complete' });
        } catch (error: any) {
            self.postMessage({ type: 'error', error: error.message });
        }
    }
};

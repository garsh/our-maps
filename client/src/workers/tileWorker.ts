import { addToManifest, getPendingFromManifest, saveTile, updateManifestStatus } from '../utils/tileUtils';

// This is a conceptual worker entry. 
// In a real Vite project, workers often need special handling.

self.onmessage = async (e) => {
    const { type, mapId, tiles } = e.data;

    if (type === 'start-download') {
        try {
            // 1. Add to manifest
            await addToManifest(tiles.map((t: any) => ({
                ...t,
                status: 'pending',
                mapId,
                updatedAt: Date.now()
            })));

            // 2. Get resumable pending
            const pending = await getPendingFromManifest(mapId);
            const total = tiles.length;
            let completedCount = total - pending.length;

            if (pending.length === 0) {
                self.postMessage({ type: 'progress', progress: 1.0 });
                return;
            }

            const CONCURRENCY = 25; // High-performance parallel pumping
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
                            const response = await fetch(entry.url, {
                                headers: {
                                    'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                                }
                            });
                            if (response.ok) {
                                const blob = await response.blob();
                                await saveTile(entry.url, blob);
                                success = true;
                            } else {
                                throw new Error(`HTTP ${response.status}`);
                            }
                        } catch (error) {
                            retries++;
                            if (retries < MAX_RETRIES) {
                                // Exponential backoff: 500ms, 1000ms, 2000ms
                                await new Promise(r => setTimeout(r, Math.pow(2, retries) * 250));
                            }
                        }
                    }

                    if (!success) {
                        await updateManifestStatus(entry.url, 'error');
                    }

                    completedCount++;
                    if (completedCount % 10 === 0 || completedCount === total) {
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

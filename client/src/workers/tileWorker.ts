import { removeMapDownload } from '../utils/tileUtils';
import { writeExtractFromStream } from '../utils/extractStore';

self.onmessage = async (e) => {
    const { type, mapId, bbox, totalTiles: requestedTotal } = e.data;

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
            if (!bbox) {
                throw new Error('A bounding box is required to download map tiles');
            }
            const origin = self.location.origin;
            const total = requestedTotal || 0;

            const streamRes = await fetch(`${origin}/api/maps/tiles/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ bbox, minZoom: 1, maxZoom: 15, mapId })
            });

            if (!streamRes.ok || !streamRes.body) {
                const message = streamRes.statusText || `HTTP ${streamRes.status}`;
                throw new Error(`Map extract failed: ${message}`);
            }

            const totalBytes = Number(streamRes.headers.get('Content-Length') || streamRes.headers.get('X-Extract-Bytes') || 0);
            const totalTiles = Number(streamRes.headers.get('X-Total-Tiles') || total || 0);
            let lastPosted = 0;

            const { bytes } = await writeExtractFromStream(mapId, streamRes.body, (received) => {
                if (!totalBytes) return;
                if (received - lastPosted < totalBytes / 100 && received < totalBytes) return;
                lastPosted = received;
                const progress = Math.min(1, received / totalBytes);
                self.postMessage({
                    type: 'progress',
                    progress,
                    completed: Math.round(progress * totalTiles),
                    total: totalTiles,
                    receivedBytes: received,
                    totalBytes
                });
            });

            self.postMessage({
                type: 'progress',
                progress: 1,
                completed: totalTiles,
                total: totalTiles,
                receivedBytes: bytes,
                totalBytes: totalBytes || bytes
            });
            self.postMessage({ type: 'complete', total: totalTiles, bytes });
        } catch (error: any) {
            self.postMessage({ type: 'error', error: error.message });
        }
    }
};

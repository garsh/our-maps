import { removeMapDownload } from '../utils/tileUtils';
import { getPartFileSize, writeExtractFromStream, writeExtractMeta } from '../utils/extractStore';

function headerNumber(headers: Headers, name: string): number {
    const value = Number(headers.get(name) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function postProgress(progress: number, totalTiles: number, receivedBytes: number, totalBytes: number) {
    const clamped = Math.min(1, Math.max(0, progress));
    self.postMessage({
        type: 'progress',
        progress: clamped,
        completed: Math.round(clamped * totalTiles),
        total: totalTiles,
        receivedBytes,
        totalBytes
    });
}

self.onmessage = async (e) => {
    const { type, mapId, bbox, totalTiles: requestedTotal, totalBytes: knownTotalBytes } = e.data;

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

            const requestExtract = (resumeOffset: number) => {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (resumeOffset > 0) {
                    headers['Range'] = `bytes=${resumeOffset}-`;
                }
                return fetch(`${origin}/api/maps/tiles/stream`, {
                    method: 'POST',
                    headers,
                    credentials: 'include',
                    body: JSON.stringify({ bbox, minZoom: 1, maxZoom: 15, mapId, offset: resumeOffset })
                });
            };

            let offset = await getPartFileSize(mapId);
            let knownTotal = Number(knownTotalBytes) || 0;
            if (offset > 0 && knownTotal > 0) {
                postProgress(offset / knownTotal, requestedTotal || 0, offset, knownTotal);
            }

            let streamRes = await requestExtract(offset);
            if (streamRes.status === 416 && offset > 0) {
                offset = 0;
                streamRes = await requestExtract(0);
            }

            if ((!streamRes.ok && streamRes.status !== 206) || !streamRes.body) {
                const message = streamRes.statusText || `HTTP ${streamRes.status}`;
                throw new Error(`Map extract failed: ${message}`);
            }

            const startOffset = streamRes.status === 206 ? offset : 0;
            const totalBytes = headerNumber(streamRes.headers, 'X-Extract-Bytes')
                || (headerNumber(streamRes.headers, 'Content-Length') + startOffset)
                || knownTotal;
            const totalTiles = headerNumber(streamRes.headers, 'X-Total-Tiles') || requestedTotal || 0;
            if (totalBytes > 0) {
                await writeExtractMeta(mapId, { totalBytes });
            }
            if (startOffset > 0 && totalBytes > 0) {
                postProgress(startOffset / totalBytes, totalTiles, startOffset, totalBytes);
            }
            let lastPosted = startOffset;

            const { bytes } = await writeExtractFromStream(mapId, streamRes.body, (received) => {
                if (!totalBytes) return;
                if (received - lastPosted < totalBytes / 100 && received < totalBytes) return;
                lastPosted = received;
                postProgress(received / totalBytes, totalTiles, received, totalBytes);
            }, { startOffset });

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

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
            console.log(`[TILE_STREAM_CLIENT][worker] Starting download for map ${mapId}: initial partFileSize=${offset}, knownTotalBytes=${knownTotal}`);

            if (offset > 0 && knownTotal > 0) {
                console.log(`[TILE_STREAM_CLIENT][worker] Emitting initial resumed progress: ${offset}/${knownTotal} (${Math.round((offset / knownTotal) * 100)}%)`);
                postProgress(offset / knownTotal, requestedTotal || 0, offset, knownTotal);
            }

            console.log(`[TILE_STREAM_CLIENT][worker] Sending fetch request to /api/maps/tiles/stream with resumeOffset=${offset}`);
            const fetchStart = Date.now();
            let streamRes = await requestExtract(offset);
            console.log(`[TILE_STREAM_CLIENT][worker] Received response in ${Date.now() - fetchStart}ms: status=${streamRes.status} (${streamRes.statusText})`);

            if (streamRes.status === 416 && offset > 0) {
                console.warn(`[TILE_STREAM_CLIENT][worker] Got 416 Range Not Satisfiable for offset ${offset}. Resetting offset to 0 and restarting.`);
                offset = 0;
                streamRes = await requestExtract(0);
                console.log(`[TILE_STREAM_CLIENT][worker] Retried fresh stream: status=${streamRes.status}`);
            }

            if ((!streamRes.ok && streamRes.status !== 206) || !streamRes.body) {
                const message = streamRes.statusText || `HTTP ${streamRes.status}`;
                console.error(`[TILE_STREAM_CLIENT][worker] Stream request failed: status=${streamRes.status}, message=${message}`);
                throw new Error(`Map extract failed: ${message}`);
            }

            const startOffset = streamRes.status === 206 ? offset : 0;
            const totalBytes = headerNumber(streamRes.headers, 'X-Extract-Bytes')
                || (headerNumber(streamRes.headers, 'Content-Length') + startOffset)
                || knownTotal;
            const totalTiles = headerNumber(streamRes.headers, 'X-Total-Tiles') || requestedTotal || 0;

            console.log(`[TILE_STREAM_CLIENT][worker] Stream established: startOffset=${startOffset}, totalBytes=${totalBytes}, totalTiles=${totalTiles}`);

            if (totalBytes > 0) {
                await writeExtractMeta(mapId, { totalBytes });
            }
            if (startOffset > 0 && totalBytes > 0) {
                postProgress(startOffset / totalBytes, totalTiles, startOffset, totalBytes);
            }
            let lastPosted = startOffset;
            let lastProgressPostTime = Date.now();

            const { bytes } = await writeExtractFromStream(mapId, streamRes.body, (received) => {
                if (!totalBytes) return;
                const now = Date.now();
                // Post progress if 1% delta or at least 1 second has elapsed since last post
                const deltaBytes = received - lastPosted;
                const timeSinceLastPost = now - lastProgressPostTime;
                if (deltaBytes < totalBytes / 100 && received < totalBytes && timeSinceLastPost < 1000) {
                    return;
                }
                lastPosted = received;
                lastProgressPostTime = now;
                postProgress(received / totalBytes, totalTiles, received, totalBytes);
            }, { startOffset });

            console.log(`[TILE_STREAM_CLIENT][worker] Download stream completed: total bytes written = ${bytes}`);
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
            console.error(`[TILE_STREAM_CLIENT][worker] Error during download:`, error);
            self.postMessage({ type: 'error', error: error.message });
        }
    }
};

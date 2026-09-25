import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiService, mapFetchTimeoutMs } from '../api';
import { tileWorkerManager } from '../../utils/tileWorkerManager';

vi.mock('../../utils/tileUtils', () => ({
  getOfflineMap: vi.fn(async () => null),
  getMapETag: vi.fn(async () => null),
  saveMapToViewCache: vi.fn(async () => {}),
  touchMapCacheAccess: vi.fn(async () => {}),
  pruneViewCache: vi.fn(async () => {}),
  currentDownloadDocumentEpoch: () => 0,
}));

describe('mapFetchTimeoutMs', () => {
  it('keeps the short timeout unless a download is receiving bytes', () => {
    expect(mapFetchTimeoutMs(null)).toBe(1500);
    expect(mapFetchTimeoutMs({ isDownloading: false, stalled: false })).toBe(1500);
    expect(mapFetchTimeoutMs({ isDownloading: true, stalled: true })).toBe(1500);
    expect(mapFetchTimeoutMs({ isDownloading: true, stalled: false })).toBe(15_000);
  });
});

describe('apiService.getMap abort', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function hangUntilAbort() {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      const fail = () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    }));
  }

  it('aborts after 1.5s when no download is active', async () => {
    vi.useFakeTimers();
    hangUntilAbort();
    vi.spyOn(tileWorkerManager, 'getStatus').mockReturnValue(null);
    const pending = apiService.getMap('map-1');
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetch).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('waits 15s while the download is still receiving bytes', async () => {
    vi.useFakeTimers();
    hangUntilAbort();
    vi.spyOn(tileWorkerManager, 'getStatus').mockReturnValue({
      mapId: 'map-1',
      isDownloading: true,
      isRemoving: false,
      isDownloaded: false,
      hasPartialDownload: false,
      stalled: false,
      downloadProgress: 0.4,
      tileStats: { completed: 4, total: 10 },
      byteStats: { received: 400, total: 1000 },
    });
    const pending = apiService.getMap('map-1');
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetch).toHaveBeenCalled();
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(13_500);
    await assertion;
  });
});

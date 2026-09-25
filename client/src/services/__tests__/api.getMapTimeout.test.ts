import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiService, mapFetchTimeoutMs } from '../api';
import { tileWorkerManager } from '../../utils/tileWorkerManager';
import { getOfflineMap } from '../../utils/tileUtils';

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

describe('api calls when the browser reports offline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('does not call fetch when the browser reports offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(apiService.getMaps()).rejects.toThrow('Offline: No network connection');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls fetch when ignoreNavigatorOnline is set', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(apiService.getMaps({ ignoreNavigatorOnline: true })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalled();
  });

  it('getMap requests the server when the browser reports offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.mocked(getOfflineMap).mockResolvedValue({ id: 'map-1', name: 'Cached', layers: [], pins: [] } as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'map-1', name: 'Server', layers: [], pins: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const data = await apiService.getMap('map-1');
    expect(fetch).toHaveBeenCalled();
    expect(data.name).toBe('Server');
  });

  it('estimateExtract requests the server when the browser reports offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      bytes: 10, addressedTiles: 2,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(apiService.estimateExtract({ west: 0, south: 0, east: 1, north: 1 })).resolves.toEqual({
      bytes: 10, addressedTiles: 2,
    });
    expect(fetch).toHaveBeenCalled();
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

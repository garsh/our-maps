import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadActivityView, TileWorkerManager, supportsBackgroundFetch } from '../tileWorkerManager';
import { extractExists } from '../extractStore';

const { removeMapDownload } = vi.hoisted(() => ({
  removeMapDownload: vi.fn(async () => {}),
}));

vi.mock('../extractStore', () => ({
  extractExists: vi.fn(async () => false),
  getExtractResumeInfo: vi.fn(async () => ({ partBytes: 400, totalBytes: 1000 })),
  getPartFileSize: vi.fn(async () => 400),
  removeExtract: vi.fn(async () => {}),
}));

vi.mock('../offlineExtract', () => ({
  invalidateExtractPMTiles: vi.fn(),
}));

vi.mock('../tileUtils', () => ({
  removeMapDownload,
  removeAllDownloads: vi.fn(async () => {}),
  getDownloadStats: vi.fn(async () => ({ total: 100, completed: 40 })),
  getOfflineMap: vi.fn(async () => null),
  saveMapOffline: vi.fn(async () => {}),
  getPinsBoundingBox: vi.fn(() => null),
}));

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((ev: { data: any }) => void) | null = null;
  terminated = false;
  posted: any[] = [];
  constructor(_url: string | URL, _opts?: WorkerOptions) {
    FakeWorker.all.push(this);
  }
  postMessage(data: any) {
    this.posted.push(data);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: any) {
    this.onmessage?.({ data });
  }
}

const bbox = { west: 0, south: 0, east: 1, north: 1 };

describe('downloadActivityView', () => {
  it('animates while progress is live', () => {
    expect(downloadActivityView({
      isDownloading: true,
      isRemoving: false,
      isDownloaded: false,
      hasPartialDownload: false,
      downloadProgress: 0.42,
      byteStats: { received: 420, total: 1000 },
      stalled: false,
    })).toEqual({ show: true, progress: 0.42, icon: 'animated' });
  });

  it('uses a stalled icon and byte percent when worker progress is null', () => {
    expect(downloadActivityView({
      isDownloading: false,
      isRemoving: false,
      isDownloaded: false,
      hasPartialDownload: true,
      downloadProgress: null,
      byteStats: { received: 250, total: 1000 },
      stalled: true,
    })).toEqual({ show: true, progress: 0.25, icon: 'stalled' });
  });

  it('keeps the last percent on a stall and does not animate', () => {
    expect(downloadActivityView({
      isDownloading: true,
      isRemoving: false,
      isDownloaded: false,
      hasPartialDownload: false,
      downloadProgress: 0.4,
      byteStats: { received: 400, total: 1000 },
      stalled: true,
    })).toEqual({ show: true, progress: 0.4, icon: 'stalled' });
  });
});

describe('TileWorkerManager transient network errors', () => {
  let manager: TileWorkerManager;
  let visibility: DocumentVisibilityState;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    removeMapDownload.mockClear();
    manager = new TileWorkerManager();
  });

  afterEach(async () => {
    await manager.removeAllDownloads();
    alertSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function begin() {
    await manager.startDownload('map-1', { bbox, totalTiles: 100 });
    return FakeWorker.all[FakeWorker.all.length - 1];
  }

  function emitProgress(worker: FakeWorker, progress = 0.42) {
    worker.emit({
      type: 'progress',
      progress,
      completed: 42,
      total: 100,
      receivedBytes: 420,
      totalBytes: 1000,
    });
  }

  it('retries a network error without alerting and keeps the last progress', async () => {
    const worker = await begin();
    emitProgress(worker);
    worker.emit({ type: 'error', error: 'network error' });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(removeMapDownload).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    const stalled = manager.getStatus('map-1');
    expect(stalled).toMatchObject({
      isDownloading: true,
      stalled: true,
      downloadProgress: 0.42,
      byteStats: { received: 420, total: 1000 },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWorker.all.length).toBe(2);
    expect(FakeWorker.all[1].terminated).toBe(false);
    expect(manager.getStatus('map-1')?.stalled).toBe(true);

    FakeWorker.all[1].emit({
      type: 'progress',
      progress: 0.5,
      completed: 50,
      total: 100,
      receivedBytes: 500,
      totalBytes: 1000,
    });
    expect(manager.getStatus('map-1')).toMatchObject({
      isDownloading: true,
      stalled: false,
      downloadProgress: 0.5,
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('alerts only after three visible network failures and can resume on the next foreground', async () => {
    let worker = await begin();
    emitProgress(worker);

    worker.emit({ type: 'error', error: 'Failed to fetch' });
    await vi.advanceTimersByTimeAsync(1000);
    worker = FakeWorker.all[FakeWorker.all.length - 1];
    worker.emit({ type: 'error', error: 'network error' });
    await vi.advanceTimersByTimeAsync(2000);
    worker = FakeWorker.all[FakeWorker.all.length - 1];
    worker.emit({ type: 'error', error: 'network error' });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Map download failed: network error');
    expect(removeMapDownload).not.toHaveBeenCalled();
    expect(manager.getStatus('map-1')).toMatchObject({
      isDownloading: false,
      stalled: true,
      hasPartialDownload: true,
    });
    expect(manager.getStatus('map-1')?.downloadProgress).not.toBeNull();
    const workersAtGiveUp = FakeWorker.all.length;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWorker.all.length).toBe(workersAtGiveUp);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWorker.all.length).toBe(workersAtGiveUp + 1);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('waits for foreground when the failure happens while hidden', async () => {
    const worker = await begin();
    emitProgress(worker);
    visibility = 'hidden';
    worker.emit({ type: 'error', error: 'network error' });

    expect(alertSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWorker.all.length).toBe(1);
    expect(manager.getStatus('map-1')).toMatchObject({
      isDownloading: true,
      stalled: true,
      downloadProgress: 0.42,
    });

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWorker.all.length).toBe(2);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('marks a backgrounded download downloaded when the extract is already on disk', async () => {
    vi.mocked(extractExists).mockResolvedValue(true);
    try {
      const worker = await begin();
      emitProgress(worker);
      const states: Array<{ isDownloaded: boolean; isDownloading: boolean }> = [];
      manager.subscribe((state) => {
        states.push({ isDownloaded: state.isDownloaded, isDownloading: state.isDownloading });
      });

      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);

      expect(worker.terminated).toBe(true);
      expect(FakeWorker.all.length).toBe(1);
      expect(manager.getStatus('map-1')).toBeNull();
      expect(states.at(-1)).toEqual({ isDownloaded: true, isDownloading: false });
      expect(JSON.parse(localStorage.getItem('cached_download_statuses') || '{}')['map-1']).toEqual({
        isComplete: true,
        isPartial: false,
      });
    } finally {
      vi.mocked(extractExists).mockResolvedValue(false);
      localStorage.removeItem('cached_download_statuses');
    }
  });

  it('restarts a frozen download without counting it as a failure', async () => {
    const worker = await begin();
    emitProgress(worker);
    document.dispatchEvent(new Event('freeze'));

    expect(worker.terminated).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(manager.getStatus('map-1')).toMatchObject({ stalled: true, isDownloading: true });

    document.dispatchEvent(new Event('resume'));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWorker.all.length).toBe(2);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('still alerts and deletes a fatal download error', async () => {
    const worker = await begin();
    worker.emit({ type: 'error', error: 'area exceeds tile limit' });

    expect(alertSpy).toHaveBeenCalledWith('Map download failed: area exceeds tile limit');
    expect(removeMapDownload).toHaveBeenCalledWith('map-1');
    expect(manager.getStatus('map-1')).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWorker.all.filter(w => !w.terminated).length).toBe(0);
  });

  it('ignores an error from a worker that has already been replaced', async () => {
    const first = await begin();
    emitProgress(first);
    first.emit({ type: 'error', error: 'network error' });
    await vi.advanceTimersByTimeAsync(1000);
    const second = FakeWorker.all[1];
    first.emit({ type: 'error', error: 'network error' });
    expect(second.terminated).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(manager.getStatus('map-1')?.isDownloading).toBe(true);
  });
});

describe('Background Fetch integration', () => {
  afterEach(() => {
    delete (window as any).BackgroundFetchManager;
    delete (navigator as any).serviceWorker;
    vi.unstubAllGlobals();
  });

  it('supportsBackgroundFetch detects presence of BackgroundFetchManager and serviceWorker', () => {
    delete (window as any).BackgroundFetchManager;
    delete (navigator as any).serviceWorker;
    expect(supportsBackgroundFetch()).toBe(false);

    (window as any).BackgroundFetchManager = class {};
    expect(supportsBackgroundFetch()).toBe(false);

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {},
    });
    expect(supportsBackgroundFetch()).toBe(true);

    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    });
    expect(supportsBackgroundFetch()).toBe(false);

    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: undefined,
    });

    delete (window as any).BackgroundFetchManager;
    delete (navigator as any).serviceWorker;
    expect(supportsBackgroundFetch()).toBe(false);
  });

  it('switches to Background Fetch when supported and reports progress and completion', async () => {
    const mockBgFetch: any = {
      id: 'map-bg-1',
      downloaded: 0,
      downloadTotal: 1000,
      result: '',
      addEventListener: vi.fn(),
      abort: vi.fn(async () => true),
    };

    let activeBgFetch: any = null;
    const mockFetch = vi.fn(async () => {
      activeBgFetch = mockBgFetch;
      return mockBgFetch;
    });
    const mockGet = vi.fn(async () => activeBgFetch);
    const mockGetIds = vi.fn(async () => (activeBgFetch ? ['map-bg-1'] : []));

    const swReg: any = {
      backgroundFetch: {
        fetch: mockFetch,
        get: mockGet,
        getIds: mockGetIds,
      },
    };

    (window as any).BackgroundFetchManager = class {};
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(swReg),
        addEventListener: vi.fn(),
      },
    });

    const manager = new TileWorkerManager();
    await manager.startDownload('map-bg-1', { bbox, totalTiles: 50 });

    expect(mockFetch).toHaveBeenCalledWith(
      'map-bg-1',
      expect.arrayContaining([expect.stringContaining('/api/maps/map-bg-1/extract.pmtiles')]),
      expect.objectContaining({ title: expect.any(String) })
    );

    expect(mockBgFetch.addEventListener).toHaveBeenCalledWith('progress', expect.any(Function));

    // Simulate progress
    mockBgFetch.downloaded = 500;
    const progressListener = mockBgFetch.addEventListener.mock.calls.find((call: any[]) => call[0] === 'progress')?.[1];
    progressListener?.();

    const status = manager.getStatus('map-bg-1');
    expect(status?.downloadProgress).toBe(0.5);
    expect(status?.byteStats?.received).toBe(500);

    // Cancel download
    await manager.cancelDownload('map-bg-1');
    expect(mockBgFetch.abort).toHaveBeenCalled();
  });

  it('falls back to Web Worker when Background Fetch fails during initiation', async () => {
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);

    const swReg: any = {
      backgroundFetch: {
        get: vi.fn(async () => null),
        fetch: vi.fn(async () => {
          throw new Error('Permission denied');
        }),
      },
    };

    (window as any).BackgroundFetchManager = class {};
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(swReg),
        addEventListener: vi.fn(),
      },
    });

    const manager = new TileWorkerManager();
    await manager.startDownload('map-fallback-1', { bbox, totalTiles: 50 });

    // Should have fallen back to FakeWorker
    expect(FakeWorker.all.length).toBe(1);
    expect(manager.getStatus('map-fallback-1')?.isDownloading).toBe(true);
  });

  it('does not stall or terminate active Background Fetch on freeze', async () => {
    const mockBgFetch: any = {
      id: 'map-bg-freeze',
      downloaded: 100,
      downloadTotal: 1000,
      result: '',
      addEventListener: vi.fn(),
      abort: vi.fn(async () => true),
    };

    const swReg: any = {
      backgroundFetch: {
        fetch: vi.fn(async () => mockBgFetch),
        get: vi.fn(async () => mockBgFetch),
        getIds: vi.fn(async () => ['map-bg-freeze']),
      },
    };

    (window as any).BackgroundFetchManager = class {};
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(swReg),
        addEventListener: vi.fn(),
      },
    });

    const manager = new TileWorkerManager();
    await manager.startDownload('map-bg-freeze', { bbox, totalTiles: 50 });

    expect(manager.getStatus('map-bg-freeze')?.isDownloading).toBe(true);
    expect(manager.getStatus('map-bg-freeze')?.stalled).toBe(false);

    document.dispatchEvent(new Event('freeze'));

    // Should still be downloading and NOT stalled
    const statusAfterFreeze = manager.getStatus('map-bg-freeze');
    expect(statusAfterFreeze?.isDownloading).toBe(true);
    expect(statusAfterFreeze?.stalled).toBe(false);
  });

  it('notifies subscribers of completion even if task was not actively tracked in manager', async () => {
    const manager = new TileWorkerManager();
    const states: any[] = [];
    manager.subscribe((state) => {
      states.push(state);
    });

    manager.notifyComplete('map-untagged', 5000);

    expect(states.length).toBe(1);
    expect(states[0]).toMatchObject({
      mapId: 'map-untagged',
      isDownloaded: true,
      isDownloading: false,
      byteStats: { received: 5000, total: 5000 },
    });
  });

  it('reconciles background fetch for map and updates status', async () => {
    const mockBgFetch: any = {
      id: 'map-reconcile-1',
      downloaded: 400,
      downloadTotal: 1000,
      result: '',
      addEventListener: vi.fn(),
      abort: vi.fn(async () => true),
    };

    const swReg: any = {
      backgroundFetch: {
        get: vi.fn(async (id: string) => (id === 'map-reconcile-1' ? mockBgFetch : null)),
        getIds: vi.fn(async () => ['map-reconcile-1']),
      },
    };

    (window as any).BackgroundFetchManager = class {};
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(swReg),
        addEventListener: vi.fn(),
      },
    });

    const manager = new TileWorkerManager();
    const state = await manager.reconcileBackgroundFetchForMap('map-reconcile-1');

    expect(state).not.toBeNull();
    expect(state?.isDownloading).toBe(true);
    expect(state?.byteStats?.received).toBe(400);
    expect(state?.downloadProgress).toBe(0.4);
  });
});

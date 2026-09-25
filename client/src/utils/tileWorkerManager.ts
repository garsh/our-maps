import { removeMapDownload, removeAllDownloads, getDownloadStats, getOfflineMap, saveMapOffline, getPinsBoundingBox, type BoundingBox, type MapDownloadStatus } from './tileUtils';
import { extractExists, getExtractResumeInfo, getPartFileSize } from './extractStore';
import { invalidateExtractPMTiles } from './offlineExtract';
import { getStoredJson, setStoredJson } from './storageUtils';
import type { Pin } from '@shared/interfaces';

const CACHED_DOWNLOAD_STATUSES_KEY = 'cached_download_statuses';

/** Landing reads this cache before the async OPFS scan. Keep it current even when Landing is unmounted. */
function rememberDownloadStatus(mapId: string, status: MapDownloadStatus | null) {
  if (typeof localStorage === 'undefined') return;
  const cached = getStoredJson<Record<string, MapDownloadStatus>>(CACHED_DOWNLOAD_STATUSES_KEY, {});
  if (status) cached[mapId] = status;
  else delete cached[mapId];
  setStoredJson(CACHED_DOWNLOAD_STATUSES_KEY, cached);
}

interface DownloadByteStats {
  received: number;
  total: number;
}

export interface DownloadProgressState {
  mapId: string;
  isDownloading: boolean;
  isRemoving: boolean;
  isDownloaded: boolean;
  hasPartialDownload: boolean;
  /** True while bytes are not arriving: retry backoff, page freeze, or retries exhausted. */
  stalled: boolean;
  downloadProgress: number | null;
  tileStats: { completed: number; total: number } | null;
  byteStats: DownloadByteStats | null;
  error?: string | null;
}

/** Visible network failures. Chrome reports a suspended stream read as "network error". */
const TRANSIENT_NETWORK_ERROR = /network error|failed to fetch|networkerror|load failed|internet connection|err_network/i;
const MAX_TRANSIENT_FAILURES = 3;
const RETRY_BASE_MS = 1000;

function isTransientNetworkError(message: string): boolean {
  return TRANSIENT_NETWORK_ERROR.test(message);
}

function isFatalDownloadError(message: string): boolean {
  return message.includes('limit') || message.includes('400') || message.includes('Bad Request') || message.includes('exceeds') || message.includes('not found');
}

type DownloadPillIcon = 'animated' | 'stalled' | 'done' | 'removing';

export function downloadActivityView(input: {
  isDownloading: boolean;
  isRemoving: boolean;
  isDownloaded: boolean;
  hasPartialDownload: boolean;
  downloadProgress: number | null;
  byteStats: DownloadByteStats | null;
  stalled?: boolean;
}): { show: boolean; progress: number | null; icon: DownloadPillIcon } {
  const showActive = input.isDownloading || input.isRemoving || input.hasPartialDownload || !!input.stalled;
  const completed = input.isDownloaded && !showActive;
  if (!showActive && !completed) {
    return { show: false, progress: null, icon: 'done' };
  }
  if (input.isRemoving) {
    return { show: true, progress: null, icon: 'removing' };
  }
  if (completed) {
    return { show: true, progress: null, icon: 'done' };
  }
  const byteProgress = input.byteStats && input.byteStats.total > 0
    ? Math.min(1, Math.max(0, input.byteStats.received / input.byteStats.total))
    : null;
  const progress = input.downloadProgress ?? byteProgress;
  // Null worker progress, or an explicit stall, means bytes are not arriving.
  const notProgressing = !!input.stalled || input.downloadProgress === null;
  return {
    show: true,
    progress,
    icon: notProgressing ? 'stalled' : 'animated',
  };
}

export function landingStatusFromWorker(state: DownloadProgressState): MapDownloadStatus | null {
  if (state.isDownloading) {
    return { isComplete: false, isPartial: true, isStalled: false };
  }
  if (state.stalled) {
    return { isComplete: false, isPartial: true, isStalled: true };
  }
  if (state.hasPartialDownload) {
    return { isComplete: false, isPartial: true, isStalled: false };
  }
  if (state.isDownloaded) {
    return { isComplete: true, isPartial: false, isStalled: false };
  }
  return null;
}

interface StartDownloadParams {
  bbox?: BoundingBox | null;
  pins?: Pin[];
  totalTiles?: number;
}

type ProgressCallback = (state: DownloadProgressState) => void;

interface StartDownloadOptions {
  /** Retry of an in-flight download. Keeps the failure count and the stalled pill. */
  automatic?: boolean;
}

interface MapTask {
  mapId: string;
  worker: Worker | null;
  isDownloading: boolean;
  isRemoving: boolean;
  downloadProgress: number | null;
  tileStats: { completed: number; total: number } | null;
  byteStats: DownloadByteStats | null;
  bbox: BoundingBox | null;
  totalTiles: number;
  stalled: boolean;
  transientFailures: number;
  gaveUp: boolean;
  alerted: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

function emptyTask(mapId: string, patch: Partial<MapTask>): MapTask {
  return {
    mapId,
    worker: null,
    isDownloading: false,
    isRemoving: false,
    downloadProgress: null,
    tileStats: null,
    byteStats: null,
    bbox: null,
    totalTiles: 0,
    stalled: false,
    transientFailures: 0,
    gaveUp: false,
    alerted: false,
    retryTimer: null,
    ...patch,
  };
}

export class TileWorkerManager {
  private tasks = new Map<string, MapTask>();
  private subscribers = new Set<ProgressCallback>();
  private pendingResume = new Set<string>();
  private starting = new Set<string>();
  private foregroundReconcile = new Set<string>();
  private hooksInstalled = false;

  private buildState(task: MapTask, error?: string | null): DownloadProgressState {
    const received = task.byteStats?.received || 0;
    const tileTotal = task.tileStats?.total || 0;
    const tileCompleted = task.tileStats?.completed || 0;
    const hasProgress = tileCompleted > 0 || received > 0;
    const tilePartial = hasProgress && tileCompleted < tileTotal && tileTotal > 0;
    return {
      mapId: task.mapId,
      isDownloading: task.isDownloading,
      isRemoving: task.isRemoving,
      isDownloaded: !task.isDownloading && !task.isRemoving && !task.stalled && task.downloadProgress === null && tileTotal > 0 && tileCompleted === tileTotal,
      hasPartialDownload: !task.isDownloading && !task.isRemoving && (tilePartial || task.stalled),
      stalled: task.stalled,
      downloadProgress: task.downloadProgress,
      tileStats: task.tileStats,
      byteStats: task.byteStats,
      error: error || null,
    };
  }

  public getStatus(mapId: string | null): DownloadProgressState | null {
    if (!mapId) return null;
    const task = this.tasks.get(mapId);
    return task ? this.buildState(task) : null;
  }

  public subscribe(callback: ProgressCallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notifySubscribers(mapId: string, error?: string | null) {
    const task = this.tasks.get(mapId);
    if (!task) return;
    const state = this.buildState(task, error);
    this.subscribers.forEach(cb => cb(state));
  }

  private installHooks() {
    if (this.hooksInstalled || typeof document === 'undefined') return;
    this.hooksInstalled = true;
    document.addEventListener('visibilitychange', this.onForeground);
    document.addEventListener('freeze', this.onFreeze as EventListener);
    document.addEventListener('resume', this.onForeground as EventListener);
    window.addEventListener('pageshow', this.onForeground);
    window.addEventListener('online', this.onForeground);
  }

  private isBackgrounded(): boolean {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return hidden || offline;
  }

  private clearRetry(task: MapTask) {
    if (task.retryTimer) {
      clearTimeout(task.retryTimer);
      task.retryTimer = null;
    }
  }

  private detachWorker(task: MapTask) {
    this.clearRetry(task);
    const worker = task.worker;
    task.worker = null;
    worker?.terminate();
  }

  private alertDownloadFailed(message: string) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(`Map download failed: ${message}`);
    }
  }

  /** A frozen page suspends the extract stream. Drop the worker and resume from the .part file on return. */
  private onFreeze = () => {
    for (const [mapId, task] of this.tasks) {
      if (task.gaveUp || (!task.isDownloading && !task.stalled)) continue;
      task.stalled = true;
      this.detachWorker(task);
      this.notifySubscribers(mapId);
    }
  };

  /**
   * A finished extract must win over a worker that was killed while the page
   * was frozen. Restarting would open a new stream and delete that file.
   */
  private finishDownloaded(task: MapTask) {
    this.detachWorker(task);
    const total = task.tileStats?.total || task.totalTiles || 1;
    task.isDownloading = false;
    task.isRemoving = false;
    task.stalled = false;
    task.gaveUp = false;
    task.downloadProgress = null;
    task.tileStats = { total, completed: total };
    if (task.byteStats && task.byteStats.total > 0) {
      task.byteStats = { received: task.byteStats.total, total: task.byteStats.total };
    }
    this.notifySubscribers(task.mapId);
    this.tasks.delete(task.mapId);
    rememberDownloadStatus(task.mapId, { isComplete: true, isPartial: false });
  }

  private async reconcileForeground(mapId: string) {
    if (this.foregroundReconcile.has(mapId)) return;
    this.foregroundReconcile.add(mapId);
    try {
      const task = this.tasks.get(mapId);
      if (!task) return;
      if (await extractExists(mapId)) {
        const live = this.tasks.get(mapId);
        if (!live) return;
        this.finishDownloaded(live);
        return;
      }
      const live = this.tasks.get(mapId);
      if (!live) return;
      if (live.gaveUp) {
        live.gaveUp = false;
        live.transientFailures = 0;
        live.stalled = true;
        live.isDownloading = true;
        this.clearRetry(live);
        this.notifySubscribers(mapId);
        void this.restartDownload(mapId);
        return;
      }
      if (live.worker || (!live.stalled && !live.isDownloading)) return;
      this.clearRetry(live);
      void this.restartDownload(mapId);
    } finally {
      this.foregroundReconcile.delete(mapId);
    }
  }

  private onForeground = () => {
    if (this.isBackgrounded()) return;
    for (const mapId of this.tasks.keys()) {
      void this.reconcileForeground(mapId);
    }
  };

  private giveUp(mapId: string, errorMsg: string) {
    const task = this.tasks.get(mapId);
    if (!task) return;
    this.clearRetry(task);
    task.gaveUp = true;
    task.stalled = true;
    task.isDownloading = false;
    this.notifySubscribers(mapId);
    if (task.alerted) return;
    task.alerted = true;
    this.alertDownloadFailed(errorMsg);
  }

  private scheduleRetry(mapId: string) {
    const task = this.tasks.get(mapId);
    if (!task || task.gaveUp || this.isBackgrounded()) return;
    this.clearRetry(task);
    const delay = RETRY_BASE_MS * (2 ** Math.max(0, task.transientFailures - 1));
    task.retryTimer = setTimeout(() => {
      const current = this.tasks.get(mapId);
      if (!current || current.gaveUp) return;
      current.retryTimer = null;
      void this.restartDownload(mapId);
    }, delay);
  }

  private restartDownload(mapId: string) {
    const task = this.tasks.get(mapId);
    if (!task || task.gaveUp || task.worker || this.starting.has(mapId)) return;
    void this.startDownload(
      mapId,
      { bbox: task.bbox, totalTiles: task.totalTiles },
      { automatic: true },
    );
  }

  public retryDownload(mapId: string): void {
    const task = this.tasks.get(mapId);
    if (!task) {
      void this.resumeIfNeeded(mapId);
      return;
    }
    this.clearRetry(task);
    task.gaveUp = false;
    task.alerted = false;
    task.transientFailures = 0;
    task.stalled = false;
    void this.startDownload(mapId, { bbox: task.bbox, totalTiles: task.totalTiles });
  }

  public async startDownload(mapId: string, params: StartDownloadParams, options?: StartDownloadOptions) {
    this.installHooks();
    const previous = this.tasks.get(mapId);
    const automatic = !!options?.automatic;

    if (previous && previous.isDownloading && previous.worker && !automatic) {
      this.notifySubscribers(mapId);
      return;
    }
    if (this.starting.has(mapId)) return;
    this.starting.add(mapId);
    try {
      if (previous) this.detachWorker(previous);

      const carriedFailures = automatic ? (previous?.transientFailures ?? 0) : 0;
      const keepStalled = automatic && !!previous && (previous.stalled || previous.transientFailures > 0);
      const bbox = params.bbox ?? previous?.bbox ?? null;
      const totalTiles = params.totalTiles || previous?.totalTiles || 0;
      const resume = await getExtractResumeInfo(mapId);
      let totalBytes = resume.totalBytes;
      if (!totalBytes) {
        const offlineMap = await getOfflineMap(mapId);
        totalBytes = offlineMap?.extractTotalBytes || 0;
      }
      const initialProgress = resume.partBytes > 0 && totalBytes > 0
        ? Math.min(1, resume.partBytes / totalBytes)
        : (resume.partBytes > 0 ? null : 0);
      const initialCompleted = initialProgress != null && totalTiles > 0
        ? Math.round(initialProgress * totalTiles)
        : 0;

      console.log(`[TILE_STREAM_CLIENT][manager] startDownload invoked for map ${mapId}: resume.partBytes=${resume.partBytes}, resume.totalBytes=${resume.totalBytes}, resolved totalBytes=${totalBytes}, initialProgress=${initialProgress}`);

      const task = emptyTask(mapId, {
        isDownloading: true,
        downloadProgress: initialProgress,
        tileStats: { completed: initialCompleted, total: totalTiles },
        byteStats: { received: resume.partBytes, total: totalBytes },
        bbox,
        totalTiles,
        stalled: keepStalled,
        transientFailures: carriedFailures,
        alerted: automatic ? (previous?.alerted ?? false) : false,
      });
      this.tasks.set(mapId, task);
      this.notifySubscribers(mapId);

      if (typeof Worker !== 'undefined') {
        const worker = new Worker(new URL('../workers/tileWorker.ts', import.meta.url), { type: 'module' });
        task.worker = worker;

        worker.postMessage({
          type: 'start-download',
          mapId,
          bbox,
          totalTiles,
          totalBytes
        });

        worker.onmessage = (e) => {
          const currentTask = this.tasks.get(mapId);
          if (!currentTask || currentTask.worker !== worker) {
            worker.terminate();
            return;
          }

          const { type, progress, error, total, completed, receivedBytes, totalBytes: progressTotalBytes, bytes } = e.data;
          if (type === 'progress') {
            const actualTotal = total || totalTiles;
            const actualCompleted = completed !== undefined ? completed : Math.round(progress * actualTotal);
            currentTask.stalled = false;
            currentTask.transientFailures = 0;
            currentTask.alerted = false;
            currentTask.gaveUp = false;
            currentTask.downloadProgress = Math.min(1, Math.max(0, progress));
            currentTask.tileStats = { total: actualTotal, completed: actualCompleted };
            const received = Number(receivedBytes);
            const knownTotal = Number(progressTotalBytes);
            currentTask.byteStats = {
              received: Number.isFinite(received) ? received : (currentTask.byteStats?.received || 0),
              total: Number.isFinite(knownTotal) && knownTotal > 0 ? knownTotal : (currentTask.byteStats?.total || 0)
            };
            this.notifySubscribers(mapId);
          } else if (type === 'complete') {
            const completedBytes = Number(bytes) || Number(progressTotalBytes) || currentTask.byteStats?.total || 0;
            const actualTotal = total || totalTiles || (completedBytes > 0 ? 1 : 0);
            console.log(`[TILE_STREAM_CLIENT][manager] Download complete event for map ${mapId}: bytes=${bytes}, totalTiles=${actualTotal}`);
            currentTask.isDownloading = false;
            currentTask.stalled = false;
            currentTask.downloadProgress = null;
            currentTask.tileStats = { total: actualTotal, completed: actualTotal };
            currentTask.byteStats = completedBytes > 0 ? { received: completedBytes, total: completedBytes } : currentTask.byteStats;
            invalidateExtractPMTiles(mapId);
            getOfflineMap(mapId).then((offlineMap) => {
              if (offlineMap) {
                offlineMap.totalTiles = actualTotal;
                offlineMap.completedTiles = actualTotal;
                if (completedBytes > 0) offlineMap.extractTotalBytes = completedBytes;
                saveMapOffline(offlineMap);
              }
            });
            this.notifySubscribers(mapId);
            this.clearRetry(currentTask);
            worker.terminate();
            currentTask.worker = null;
            this.tasks.delete(mapId);
            rememberDownloadStatus(mapId, { isComplete: true, isPartial: false });
          } else if (type === 'error') {
            console.error(`[TILE_STREAM_CLIENT][manager] Worker error for map ${mapId}:`, error);
            const hadProgress = ((currentTask.byteStats?.received || 0) > 0) || ((currentTask.tileStats?.completed || 0) > 0);
            const errorMsg = String(error || 'Download error');
            const fatal = isFatalDownloadError(errorMsg);
            currentTask.worker = null;
            worker.terminate();

            if (!fatal && isTransientNetworkError(errorMsg)) {
              currentTask.stalled = true;
              currentTask.isDownloading = true;
              this.notifySubscribers(mapId);
              if (this.isBackgrounded()) return;
              currentTask.transientFailures += 1;
              if (currentTask.transientFailures >= MAX_TRANSIENT_FAILURES) {
                this.giveUp(mapId, errorMsg);
                return;
              }
              this.scheduleRetry(mapId);
              return;
            }

            currentTask.isDownloading = false;
            currentTask.stalled = false;
            currentTask.downloadProgress = null;

            if (!hadProgress || fatal) {
              currentTask.tileStats = null;
              currentTask.byteStats = null;
              void removeMapDownload(mapId);
            }

            this.notifySubscribers(mapId, errorMsg);
            this.tasks.delete(mapId);

            if (error) this.alertDownloadFailed(errorMsg);
          }
        };
      }
    } finally {
      this.starting.delete(mapId);
    }
  }

  public async resumeIfNeeded(mapId: string) {
    // Deduplicate: if a resumeIfNeeded call for this mapId is already in-flight
    // (awaiting OPFS/IndexedDB reads), drop this one to prevent race conditions
    // that would spawn multiple workers for the same map.
    if (this.pendingResume.has(mapId)) {
      console.log(`[TILE_STREAM_CLIENT][manager] resumeIfNeeded(${mapId}): already in-flight, skipping duplicate`);
      return;
    }
    this.pendingResume.add(mapId);
    try {
      const task = this.tasks.get(mapId);
      if (task?.gaveUp) return;
      if (task && task.isDownloading && task.worker) {
        this.notifySubscribers(mapId);
        return;
      }

      if (await extractExists(mapId)) {
        console.log(`[TILE_STREAM_CLIENT][manager] resumeIfNeeded(${mapId}): extract already exists, skipping`);
        return;
      }
      const partSize = await getPartFileSize(mapId);
      const stats = await getDownloadStats(mapId);
      const incomplete = stats.total > 0 && stats.completed > 0 && stats.completed < stats.total;
      if (partSize <= 0 && !incomplete) {
        const live = this.tasks.get(mapId);
        if (live && !live.gaveUp && (live.isDownloading || live.stalled)) {
          await this.startDownload(mapId, { bbox: live.bbox, totalTiles: live.totalTiles || stats.total }, { automatic: true });
          return;
        }
        if (stats.total > 0 && stats.completed === 0) {
          await removeMapDownload(mapId);
        }
        return;
      }
      const offlineMap = await getOfflineMap(mapId);
      if (!offlineMap) {
        console.log(`[TILE_STREAM_CLIENT][manager] resumeIfNeeded(${mapId}): no offlineMap metadata found`);
        return;
      }
      console.log(`[TILE_STREAM_CLIENT][manager] resumeIfNeeded(${mapId}): partSize=${partSize}, stats=${JSON.stringify(stats)}, incomplete=${incomplete}`);
      const bbox = offlineMap.pins ? getPinsBoundingBox(offlineMap.pins) : null;
      this.startDownload(mapId, { bbox, pins: offlineMap.pins, totalTiles: stats.total || offlineMap.totalTiles }, { automatic: true });
    } finally {
      this.pendingResume.delete(mapId);
    }
  }

  public async cancelDownload(mapId: string): Promise<void> {
    const existingTask = this.tasks.get(mapId);
    if (existingTask) this.detachWorker(existingTask);

    const task = emptyTask(mapId, { isRemoving: true });
    this.tasks.set(mapId, task);
    this.notifySubscribers(mapId);

    return new Promise<void>((resolve) => {
      if (typeof Worker !== 'undefined') {
        const worker = new Worker(new URL('../workers/tileWorker.ts', import.meta.url), { type: 'module' });
        task.worker = worker;

        worker.postMessage({ type: 'remove-download', mapId });

        worker.onmessage = (e) => {
          const currentTask = this.tasks.get(mapId);
          const { type } = e.data;
          if (type === 'remove-complete' || type === 'error') {
            invalidateExtractPMTiles(mapId);
            if (currentTask && currentTask.worker === worker) {
              currentTask.isDownloading = false;
              currentTask.isRemoving = false;
              currentTask.downloadProgress = null;
              currentTask.tileStats = null;
              currentTask.byteStats = null;
              this.notifySubscribers(mapId);
              worker.terminate();
              currentTask.worker = null;
              this.tasks.delete(mapId);
              rememberDownloadStatus(mapId, null);
            } else {
              worker.terminate();
            }
            resolve();
          }
        };
      } else {
        invalidateExtractPMTiles(mapId);
        removeMapDownload(mapId).finally(() => {
          const currentTask = this.tasks.get(mapId);
          if (currentTask) {
            currentTask.isDownloading = false;
            currentTask.isRemoving = false;
            currentTask.downloadProgress = null;
            currentTask.tileStats = null;
            currentTask.byteStats = null;
            this.notifySubscribers(mapId);
            this.tasks.delete(mapId);
          }
          resolve();
        });
      }
    });
  }

  public async removeAllDownloads(): Promise<void> {
    for (const task of this.tasks.values()) {
      this.detachWorker(task);
    }
    const mapIds = Array.from(this.tasks.keys());
    this.tasks.clear();

    invalidateExtractPMTiles();
    await removeAllDownloads();

    for (const mapId of mapIds) {
      this.subscribers.forEach(cb => cb({
        mapId,
        isDownloading: false,
        isRemoving: false,
        isDownloaded: false,
        hasPartialDownload: false,
        stalled: false,
        downloadProgress: null,
        tileStats: null,
        byteStats: null
      }));
    }
  }
}

export const tileWorkerManager = new TileWorkerManager();

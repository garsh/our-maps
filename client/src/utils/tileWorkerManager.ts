import { removeMapDownload, removeAllDownloads, getDownloadStats, getOfflineMap, saveMapOffline, getPinsBoundingBox, type BoundingBox, type MapDownloadStatus } from './tileUtils';
import { extractExists, getExtractResumeInfo, getPartFileSize, removeExtract } from './extractStore';
import { invalidateExtractPMTiles } from './offlineExtract';
import { readAccountJson, writeAccountJson } from './accountScope';
import type { Pin } from '@shared/interfaces';

const CACHED_DOWNLOAD_STATUSES_KEY = 'cached_download_statuses';

/** Landing reads this cache before the async OPFS scan. Keep it current even when Landing is unmounted. */
function rememberDownloadStatus(mapId: string, status: MapDownloadStatus | null) {
  if (typeof localStorage === 'undefined') return;
  const cached = readAccountJson<Record<string, MapDownloadStatus>>(CACHED_DOWNLOAD_STATUSES_KEY, {});
  if (status) cached[mapId] = status;
  else delete cached[mapId];
  writeAccountJson(CACHED_DOWNLOAD_STATUSES_KEY, cached);
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
  return message.includes('limit') ||
         message.includes('400') ||
         message.includes('Bad Request') ||
         message.includes('exceeds') ||
         message.includes('not found') ||
         message.includes('storage') ||
         message.includes('secure');
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
  // Null computed progress, or an explicit stall, means bytes are not arriving.
  const notProgressing = !!input.stalled || progress === null;
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

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (import.meta.env?.MODE === 'test' || typeof (globalThis as any).vi !== 'undefined' || (globalThis as any).process?.env?.NODE_ENV === 'test') {
    return true;
  }
  if ((navigator as any).userAgentData?.mobile !== undefined) {
    return Boolean((navigator as any).userAgentData.mobile);
  }
  const ua = navigator.userAgent || '';
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

export function canAccessBackgroundFetch(): boolean {
  return typeof window !== 'undefined' &&
         'serviceWorker' in navigator &&
         'BackgroundFetchManager' in window;
}

export function supportsBackgroundFetch(): boolean {
  return typeof window !== 'undefined' &&
         window.isSecureContext !== false &&
         isMobileDevice() &&
         canAccessBackgroundFetch();
}

export async function getReadyServiceWorker(timeoutMs = 3000): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const swReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return swReg;
  } catch {
    return null;
  }
}

interface MapTask {
  mapId: string;
  worker: Worker | null;
  bgFetch?: BackgroundFetchRegistration | null;
  bgFetchPollTimer?: ReturnType<typeof setInterval> | null;
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
    bgFetch: null,
    bgFetchPollTimer: null,
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
  private channel: BroadcastChannel | null = null;

  private buildState(task: MapTask, error?: string | null): DownloadProgressState {
    const received = task.byteStats?.received || 0;
    const tileTotal = task.tileStats?.total || 0;
    const tileCompleted = task.tileStats?.completed || 0;
    const hasProgress = tileCompleted > 0 || received > 0;
    const tilePartial = hasProgress && tileCompleted < tileTotal && tileTotal > 0;
    const isDone = !task.isDownloading && !task.isRemoving && !task.stalled && task.downloadProgress === null && (
      (tileTotal > 0 && tileCompleted === tileTotal) ||
      (task.byteStats !== null && task.byteStats.total > 0 && task.byteStats.received >= task.byteStats.total)
    );
    return {
      mapId: task.mapId,
      isDownloading: task.isDownloading,
      isRemoving: task.isRemoving,
      isDownloaded: isDone,
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
    this.installHooks();
    const task = this.tasks.get(mapId);
    return task ? this.buildState(task) : null;
  }

  public subscribe(callback: ProgressCallback): () => void {
    this.installHooks();
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

  public notifyComplete(mapId: string, totalBytes?: number) {
    const existing = this.tasks.get(mapId);
    if (existing?.bgFetchPollTimer) {
      clearInterval(existing.bgFetchPollTimer);
      existing.bgFetchPollTimer = null;
    }
    this.tasks.delete(mapId);
    rememberDownloadStatus(mapId, { isComplete: true, isPartial: false, isStalled: false });
    invalidateExtractPMTiles(mapId);

    const bytes = totalBytes || existing?.byteStats?.total || existing?.byteStats?.received || 0;
    const totalTiles = existing?.tileStats?.total || existing?.totalTiles || 1;

    const state: DownloadProgressState = {
      mapId,
      isDownloading: false,
      isRemoving: false,
      isDownloaded: true,
      hasPartialDownload: false,
      stalled: false,
      downloadProgress: null,
      tileStats: { total: totalTiles, completed: totalTiles },
      byteStats: bytes > 0 ? { received: bytes, total: bytes } : null,
      error: null,
    };
    this.subscribers.forEach(cb => cb(state));
  }

  public notifyFailed(mapId: string, error?: string | null) {
    const existing = this.tasks.get(mapId);
    if (existing?.bgFetchPollTimer) {
      clearInterval(existing.bgFetchPollTimer);
      existing.bgFetchPollTimer = null;
    }
    this.tasks.delete(mapId);
    rememberDownloadStatus(mapId, null);

    const state: DownloadProgressState = {
      mapId,
      isDownloading: false,
      isRemoving: false,
      isDownloaded: false,
      hasPartialDownload: false,
      stalled: false,
      downloadProgress: null,
      tileStats: null,
      byteStats: null,
      error: error || 'Background fetch failed',
    };
    this.subscribers.forEach(cb => cb(state));
  }

  public notifyAborted(mapId: string) {
    const existing = this.tasks.get(mapId);
    if (existing?.bgFetchPollTimer) {
      clearInterval(existing.bgFetchPollTimer);
      existing.bgFetchPollTimer = null;
    }
    this.tasks.delete(mapId);
    rememberDownloadStatus(mapId, null);

    const state: DownloadProgressState = {
      mapId,
      isDownloading: false,
      isRemoving: false,
      isDownloaded: false,
      hasPartialDownload: false,
      stalled: false,
      downloadProgress: null,
      tileStats: null,
      byteStats: null,
      error: null,
    };
    this.subscribers.forEach(cb => cb(state));
  }

  private setupBroadcastChannel() {
    if (typeof BroadcastChannel !== 'undefined' && !this.channel) {
      try {
        this.channel = new BroadcastChannel('offline-map-downloads');
        this.channel.onmessage = (event) => {
          this.handleBackgroundFetchMessage(event.data);
        };
      } catch (err) {
        console.warn('Failed to initialize BroadcastChannel:', err);
      }
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
      try {
        navigator.serviceWorker.addEventListener('message', (event) => {
          this.handleBackgroundFetchMessage(event.data);
        });
      } catch (err) {
        // ignore
      }
    }
  }

  private handleBackgroundFetchMessage(data: any) {
    const { type, mapId, totalBytes, error } = data || {};
    if (!mapId) return;
    if (type === 'bg-fetch-success') {
      const task = this.tasks.get(mapId);
      if (task) {
        if (totalBytes > 0 && task.byteStats) {
          task.byteStats = { received: totalBytes, total: totalBytes };
        }
        this.finishDownloaded(task);
      } else {
        this.notifyComplete(mapId, totalBytes);
      }
    } else if (type === 'bg-fetch-fail') {
      this.notifyFailed(mapId, error || 'Background fetch failed');
    } else if (type === 'bg-fetch-abort') {
      this.notifyAborted(mapId);
    }
  }

  private attachBackgroundFetch(
    mapId: string,
    bgFetch: BackgroundFetchRegistration,
    totalTiles?: number,
    expectedBytes?: number
  ) {
    let task = this.tasks.get(mapId);
    const existingTotalTiles = totalTiles || task?.totalTiles || 0;
    const existingExpectedBytes = expectedBytes || bgFetch.downloadTotal || task?.byteStats?.total || 0;

    if (!task) {
      task = emptyTask(mapId, {
        isDownloading: true,
        totalTiles: existingTotalTiles,
        tileStats: existingTotalTiles > 0 ? { total: existingTotalTiles, completed: 0 } : null,
        byteStats: { received: bgFetch.downloaded, total: existingExpectedBytes },
      });
      this.tasks.set(mapId, task);
    } else {
      task.isDownloading = true;
      task.stalled = false;
      task.transientFailures = 0;
      if (existingTotalTiles > 0) task.totalTiles = existingTotalTiles;
    }
    task.bgFetch = bgFetch;

    if (task.bgFetchPollTimer) {
      clearInterval(task.bgFetchPollTimer);
      task.bgFetchPollTimer = null;
    }

    const updateProgress = () => {
      const current = this.tasks.get(mapId);
      if (!current || !current.isDownloading) return;
      const downloaded = bgFetch.downloaded;
      const total = bgFetch.downloadTotal || current.byteStats?.total || existingExpectedBytes || 0;
      const progress = total > 0 ? Math.min(1, Math.max(0, downloaded / total)) : null;

      current.downloadProgress = progress;
      current.byteStats = { received: downloaded, total };
      if (current.totalTiles > 0 && progress !== null) {
        current.tileStats = {
          total: current.totalTiles,
          completed: Math.round(progress * current.totalTiles),
        };
      }
      rememberDownloadStatus(mapId, { isComplete: false, isPartial: true, isStalled: false });
      this.notifySubscribers(mapId);
    };

    bgFetch.addEventListener('progress', updateProgress);
    updateProgress();

    task.bgFetchPollTimer = setInterval(async () => {
      const current = this.tasks.get(mapId);
      if (!current || !current.isDownloading || current.bgFetch !== bgFetch) {
        if (task.bgFetchPollTimer) {
          clearInterval(task.bgFetchPollTimer);
          task.bgFetchPollTimer = null;
        }
        return;
      }

      if (bgFetch.result === 'success') {
        if (task.bgFetchPollTimer) {
          clearInterval(task.bgFetchPollTimer);
          task.bgFetchPollTimer = null;
        }
        if (await extractExists(mapId)) {
          this.notifyComplete(mapId, bgFetch.downloaded);
        }
        return;
      }

      if (bgFetch.result === 'failure') {
        if (task.bgFetchPollTimer) {
          clearInterval(task.bgFetchPollTimer);
          task.bgFetchPollTimer = null;
        }
        this.notifyFailed(mapId, 'Background fetch failed');
        return;
      }

      updateProgress();
    }, 1000);
  }

  public async reconcileBackgroundFetchForMap(mapId: string): Promise<DownloadProgressState | null> {
    if (!supportsBackgroundFetch()) return null;
    try {
      const swReg = await getReadyServiceWorker(1500);
      if (!swReg || !('backgroundFetch' in swReg) || !swReg.backgroundFetch) return null;
      let bgFetch = await swReg.backgroundFetch.get(mapId);
      if (!bgFetch && !mapId.startsWith('map-')) {
        bgFetch = await swReg.backgroundFetch.get(`map-${mapId}`);
      }
      if (!bgFetch) return null;
      if (await extractExists(mapId)) {
        this.notifyComplete(mapId, bgFetch.downloaded);
        return this.getStatus(mapId);
      }
      if (bgFetch.result === 'success') {
        let exists = false;
        for (let i = 0; i < 6; i++) {
          exists = await extractExists(mapId);
          if (exists) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (exists) {
          this.notifyComplete(mapId, bgFetch.downloaded);
          return this.getStatus(mapId);
        }
      } else if (!bgFetch.result) {
        const stats = await getDownloadStats(mapId);
        this.attachBackgroundFetch(mapId, bgFetch, stats.total, bgFetch.downloadTotal || 0);
        return this.getStatus(mapId);
      }
    } catch (err) {
      console.warn(`[TILE_STREAM_CLIENT][manager] Error reconciling background fetch for ${mapId}:`, err);
    }
    return null;
  }

  public async reconcileBackgroundFetches(): Promise<void> {
    if (!supportsBackgroundFetch()) return;
    try {
      const swReg = await getReadyServiceWorker(3000);
      if (!swReg || !('backgroundFetch' in swReg) || !swReg.backgroundFetch) return;
      const ids = await swReg.backgroundFetch.getIds();
      for (const id of ids) {
        const bgFetch = await swReg.backgroundFetch.get(id);
        if (!bgFetch) continue;
        const mapId = id.replace(/^map-/, '');
        if (await extractExists(mapId)) {
          this.notifyComplete(mapId, bgFetch.downloaded);
        } else if (bgFetch.result === 'failure') {
          this.notifyFailed(mapId, 'Background fetch failed');
        } else if (bgFetch.result === 'success') {
          const task = this.tasks.get(mapId);
          if (task && task.isDownloading) {
            let exists = false;
            for (let i = 0; i < 6; i++) {
              exists = await extractExists(mapId);
              if (exists) break;
              await new Promise(r => setTimeout(r, 500));
            }
            if (exists) {
              this.notifyComplete(mapId, bgFetch.downloaded);
            }
          }
        } else if (!bgFetch.result) {
          const stats = await getDownloadStats(mapId);
          this.attachBackgroundFetch(mapId, bgFetch, stats.total, bgFetch.downloadTotal || 0);
        }
      }
    } catch (err) {
      console.warn('[TILE_STREAM_CLIENT][manager] Error reconciling background fetches:', err);
    }
  }

  public installHooks() {
    if (this.hooksInstalled || typeof document === 'undefined') return;
    this.hooksInstalled = true;
    document.addEventListener('visibilitychange', this.onForeground);
    document.addEventListener('freeze', this.onFreeze as EventListener);
    document.addEventListener('resume', this.onForeground as EventListener);
    window.addEventListener('pageshow', this.onForeground);
    window.addEventListener('online', this.onForeground);
    this.setupBroadcastChannel();
    void this.reconcileBackgroundFetches();
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
    if (task.bgFetchPollTimer) {
      clearInterval(task.bgFetchPollTimer);
      task.bgFetchPollTimer = null;
    }
  }

  private alertDownloadFailed(message: string) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(`Map download failed: ${message}`);
    }
  }

  /** A frozen page suspends the extract stream. Drop the worker and resume from the .part file on return. */
  private onFreeze = () => {
    for (const [mapId, task] of this.tasks) {
      if (task.bgFetch) continue;
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
    if (task.bgFetchPollTimer) {
      clearInterval(task.bgFetchPollTimer);
      task.bgFetchPollTimer = null;
    }
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
    invalidateExtractPMTiles(task.mapId);
  }

  private async reconcileForeground(mapId: string) {
    if (this.foregroundReconcile.has(mapId)) return;
    this.foregroundReconcile.add(mapId);
    try {
      const task = this.tasks.get(mapId);
      if (!task) return;
      if (await extractExists(mapId)) {
        const live = this.tasks.get(mapId);
        if (!live) {
          this.notifyComplete(mapId);
          return;
        }
        this.finishDownloaded(live);
        return;
      }
      if (task.bgFetch) {
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
    void this.reconcileBackgroundFetches();
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

      console.log(`[TILE_STREAM_CLIENT][manager] startDownload: supportsBackgroundFetch=${supportsBackgroundFetch()}, isSecureContext=${typeof window !== 'undefined' ? window.isSecureContext : 'n/a'}, mapId=${mapId}`);
      if (supportsBackgroundFetch()) {
        try {
          const swReg = await getReadyServiceWorker(3000);
          console.log(`[TILE_STREAM_CLIENT][manager] Service worker ready: ${Boolean(swReg)}, backgroundFetch: ${Boolean(swReg && 'backgroundFetch' in swReg && swReg.backgroundFetch)}`);
          if (swReg && 'backgroundFetch' in swReg && swReg.backgroundFetch) {
            let bgFetch = await swReg.backgroundFetch.get(mapId);
            if (!bgFetch && !mapId.startsWith('map-')) {
              bgFetch = await swReg.backgroundFetch.get(`map-${mapId}`);
            }
            if (!bgFetch) {
              const queryParams = new URLSearchParams();
              if (bbox) {
                queryParams.set('north', bbox.north.toString());
                queryParams.set('south', bbox.south.toString());
                queryParams.set('east', bbox.east.toString());
                queryParams.set('west', bbox.west.toString());
                queryParams.set('minZoom', '0');
                queryParams.set('maxZoom', '15');
              }
              const qs = queryParams.toString();
              const extractUrl = `/api/maps/${mapId}/extract.pmtiles${qs ? `?${qs}` : ''}`;

              const offlineMap = await getOfflineMap(mapId);
              const title = offlineMap?.name ? `Downloading ${offlineMap.name}` : `Downloading map`;

              console.log(`[TILE_STREAM_CLIENT][manager] Calling swReg.backgroundFetch.fetch for ${mapId}: extractUrl=${extractUrl}, totalBytes=${totalBytes}`);
              bgFetch = await swReg.backgroundFetch.fetch(mapId, [extractUrl], {
                title,
                icons: [{ src: '/pwa-icon.svg', sizes: '192x192', type: 'image/svg+xml' }],
                downloadTotal: totalBytes > 0 ? totalBytes : undefined,
              });
              console.log(`[TILE_STREAM_CLIENT][manager] Background fetch registration created for ${mapId}`);
            } else {
              console.log(`[TILE_STREAM_CLIENT][manager] Attached to existing Background fetch registration for ${mapId}: downloaded=${bgFetch.downloaded}/${bgFetch.downloadTotal}`);
            }

            this.attachBackgroundFetch(mapId, bgFetch, totalTiles, totalBytes);
            return;
          }
        } catch (bgErr) {
          console.warn(`[TILE_STREAM_CLIENT][manager] Background fetch initiation failed, falling back to Web Worker:`, bgErr);
        }
      }

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
    this.installHooks();
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
      if (task && task.isDownloading && (task.worker || task.bgFetch)) {
        this.notifySubscribers(mapId);
        return;
      }

      if (await extractExists(mapId)) {
        console.log(`[TILE_STREAM_CLIENT][manager] resumeIfNeeded(${mapId}): extract already exists, skipping`);
        return;
      }

      if (supportsBackgroundFetch()) {
        const activeState = await this.reconcileBackgroundFetchForMap(mapId);
        if (activeState && (activeState.isDownloading || activeState.isDownloaded)) {
          return;
        }
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
        if (stats.total > 0 && stats.completed === 0 && !supportsBackgroundFetch()) {
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
    if (existingTask?.bgFetchPollTimer) {
      clearInterval(existingTask.bgFetchPollTimer);
      existingTask.bgFetchPollTimer = null;
    }

    if (canAccessBackgroundFetch()) {
      try {
        const swReg = await getReadyServiceWorker(2000);
        if (swReg && 'backgroundFetch' in swReg && swReg.backgroundFetch) {
          const bgFetch = existingTask?.bgFetch || await swReg.backgroundFetch.get(mapId) || (!mapId.startsWith('map-') ? await swReg.backgroundFetch.get(`map-${mapId}`) : null);
          if (bgFetch) {
            try {
              await bgFetch.abort();
            } catch {
              // Ignore if already completed or aborted
            }
          }
        }
      } catch (err) {
        console.warn(`[TILE_STREAM_CLIENT][manager] Error aborting background fetch for ${mapId}:`, err);
      }
    }

    if (existingTask) this.detachWorker(existingTask);

    const task = emptyTask(mapId, { isRemoving: true });
    this.tasks.set(mapId, task);
    this.notifySubscribers(mapId);

    try {
      invalidateExtractPMTiles(mapId);
      await removeMapDownload(mapId);
      await removeExtract(mapId);
    } finally {
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
      rememberDownloadStatus(mapId, null);
    }
  }

  public async removeAllDownloads(): Promise<void> {
    for (const task of this.tasks.values()) {
      if (task.bgFetchPollTimer) {
        clearInterval(task.bgFetchPollTimer);
        task.bgFetchPollTimer = null;
      }
      this.detachWorker(task);
    }
    const mapIds = Array.from(this.tasks.keys());
    this.tasks.clear();

    if (canAccessBackgroundFetch()) {
      try {
        const swReg = await getReadyServiceWorker(2000);
        if (swReg && 'backgroundFetch' in swReg && swReg.backgroundFetch) {
          const ids = await swReg.backgroundFetch.getIds();
          for (const id of ids) {
            try {
              const bgFetch = await swReg.backgroundFetch.get(id);
              if (bgFetch) await bgFetch.abort();
            } catch {
              // Ignore if already completed/aborted
            }
          }
        }
      } catch (err) {
        console.warn(`[TILE_STREAM_CLIENT][manager] Error aborting all background fetches:`, err);
      }
    }

    invalidateExtractPMTiles();
    await removeAllDownloads();

    for (const mapId of mapIds) {
      rememberDownloadStatus(mapId, null);
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
if (typeof window !== 'undefined') {
  tileWorkerManager.installHooks();
}

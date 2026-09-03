import { removeMapDownload, removeAllDownloads, getDownloadStats, getOfflineMap, saveMapOffline, getPinsBoundingBox, type BoundingBox } from './tileUtils';
import { extractExists, getExtractResumeInfo, getPartFileSize } from './extractStore';
import { invalidateExtractPMTiles } from './offlineExtract';
import type { Pin } from '@shared/interfaces';

export interface DownloadByteStats {
  received: number;
  total: number;
}

export interface DownloadProgressState {
  mapId: string;
  isDownloading: boolean;
  isRemoving: boolean;
  isDownloaded: boolean;
  hasPartialDownload: boolean;
  downloadProgress: number | null;
  tileStats: { completed: number; total: number } | null;
  byteStats: DownloadByteStats | null;
}

export interface StartDownloadParams {
  bbox?: BoundingBox | null;
  pins?: Pin[];
  totalTiles?: number;
}

type ProgressCallback = (state: DownloadProgressState) => void;

interface MapTask {
  mapId: string;
  worker: Worker | null;
  isDownloading: boolean;
  isRemoving: boolean;
  downloadProgress: number | null;
  tileStats: { completed: number; total: number } | null;
  byteStats: DownloadByteStats | null;
}

class TileWorkerManager {
  private tasks = new Map<string, MapTask>();
  private subscribers = new Set<ProgressCallback>();

  public getStatus(mapId: string | null): DownloadProgressState | null {
    if (!mapId) return null;
    const task = this.tasks.get(mapId);
    if (task) {
      return {
        mapId,
        isDownloading: task.isDownloading,
        isRemoving: task.isRemoving,
        isDownloaded: !task.isDownloading && !task.isRemoving && task.downloadProgress === null && (task.tileStats?.completed === task.tileStats?.total && (task.tileStats?.total || 0) > 0),
        hasPartialDownload: !task.isDownloading && !task.isRemoving && (task.tileStats?.completed || 0) < (task.tileStats?.total || 0) && (task.tileStats?.total || 0) > 0,
        downloadProgress: task.downloadProgress,
        tileStats: task.tileStats,
        byteStats: task.byteStats
      };
    }
    return null;
  }

  public subscribe(callback: ProgressCallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notifySubscribers(mapId: string) {
    const task = this.tasks.get(mapId);
    if (!task) return;
    const state: DownloadProgressState = {
      mapId,
      isDownloading: task.isDownloading,
      isRemoving: task.isRemoving,
      isDownloaded: !task.isDownloading && !task.isRemoving && task.downloadProgress === null && (task.tileStats?.completed === task.tileStats?.total && (task.tileStats?.total || 0) > 0),
      hasPartialDownload: !task.isDownloading && !task.isRemoving && (task.tileStats?.completed || 0) < (task.tileStats?.total || 0) && (task.tileStats?.total || 0) > 0,
      downloadProgress: task.downloadProgress,
      tileStats: task.tileStats,
      byteStats: task.byteStats
    };
    this.subscribers.forEach(cb => cb(state));
  }

  public async startDownload(mapId: string, params: StartDownloadParams) {
    let task = this.tasks.get(mapId);

    if (task && task.isDownloading && task.worker) {
      this.notifySubscribers(mapId);
      return;
    }

    if (task && task.worker) {
      task.worker.terminate();
      task.worker = null;
    }

    const bbox = params.bbox;
    const totalTiles = params.totalTiles || 0;
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

    task = {
      mapId,
      worker: null,
      isDownloading: true,
      isRemoving: false,
      downloadProgress: initialProgress,
      tileStats: { completed: initialCompleted, total: totalTiles },
      byteStats: { received: resume.partBytes, total: totalBytes }
    };
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
          const actualTotal = total || totalTiles;
          currentTask.isDownloading = false;
          currentTask.downloadProgress = null;
          currentTask.tileStats = { total: actualTotal, completed: actualTotal };
          const completedBytes = Number(bytes) || Number(progressTotalBytes) || currentTask.byteStats?.total || 0;
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
          worker.terminate();
          currentTask.worker = null;
          this.tasks.delete(mapId);
        } else if (type === 'error') {
          console.error(`Worker error for map ${mapId}:`, error);
          currentTask.isDownloading = false;
          currentTask.downloadProgress = null;
          this.notifySubscribers(mapId);
          worker.terminate();
          currentTask.worker = null;
          this.tasks.delete(mapId);
        }
      };
    }
  }

  public async resumeIfNeeded(mapId: string) {
    const task = this.tasks.get(mapId);
    if (task && task.isDownloading && task.worker) {
      this.notifySubscribers(mapId);
      return;
    }

    if (await extractExists(mapId)) return;
    const partSize = await getPartFileSize(mapId);
    const stats = await getDownloadStats(mapId);
    const offlineMap = await getOfflineMap(mapId);
    if (!offlineMap) return;
    const incomplete = stats.total > 0 && stats.completed < stats.total;
    if (partSize > 0 || incomplete) {
      const bbox = offlineMap.pins ? getPinsBoundingBox(offlineMap.pins) : null;
      this.startDownload(mapId, { bbox, pins: offlineMap.pins, totalTiles: stats.total || offlineMap.totalTiles });
    }
  }

  public async cancelDownload(mapId: string): Promise<void> {
    const existingTask = this.tasks.get(mapId);
    if (existingTask && existingTask.worker) {
      existingTask.worker.terminate();
      existingTask.worker = null;
    }

    const task: MapTask = {
      mapId,
      worker: null,
      isDownloading: false,
      isRemoving: true,
      downloadProgress: null,
      tileStats: null,
      byteStats: null
    };
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
      if (task.worker) {
        task.worker.terminate();
        task.worker = null;
      }
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
        downloadProgress: null,
        tileStats: null,
        byteStats: null
      }));
    }
  }
}

export const tileWorkerManager = new TileWorkerManager();

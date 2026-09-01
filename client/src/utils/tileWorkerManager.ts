import { removeMapDownload, removeAllDownloads, getManifestStats, getOfflineMap, saveMapOffline, getPinsBoundingBox, type TileInfo, type BoundingBox } from './tileUtils';
import type { Pin } from '@shared/interfaces';

export interface DownloadProgressState {
  mapId: string;
  isDownloading: boolean;
  isRemoving: boolean;
  isDownloaded: boolean;
  hasPartialDownload: boolean;
  downloadProgress: number | null;
  tileStats: { completed: number; total: number } | null;
}

export interface StartDownloadParams {
  bbox?: BoundingBox | null;
  pins?: Pin[];
  tiles?: TileInfo[];
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
        tileStats: task.tileStats
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
      tileStats: task.tileStats
    };
    this.subscribers.forEach(cb => cb(state));
  }

  public async startDownload(mapId: string, params: TileInfo[] | StartDownloadParams) {
    let task = this.tasks.get(mapId);

    // If already downloading this map, don't restart it
    if (task && task.isDownloading && task.worker) {
      this.notifySubscribers(mapId);
      return;
    }

    // If an existing worker is running for this map (e.g. removal), terminate it
    if (task && task.worker) {
      task.worker.terminate();
      task.worker = null;
    }

    let tilesList: TileInfo[] | undefined;
    let bbox: BoundingBox | null | undefined;
    let pins: Pin[] | undefined;
    let totalTiles = 0;

    if (Array.isArray(params)) {
      tilesList = params;
      totalTiles = params.length;
    } else {
      tilesList = params.tiles;
      bbox = params.bbox;
      pins = params.pins;
      totalTiles = params.totalTiles || (params.tiles ? params.tiles.length : 0);
    }

    let initialCompleted = tilesList ? tilesList.filter((t: any) => t.status === 'completed').length : 0;
    if (initialCompleted === 0 && mapId) {
      const stats = await getManifestStats(mapId);
      if (stats.completed > 0 && stats.completed < stats.total) {
        initialCompleted = stats.completed;
      }
    }

    task = {
      mapId,
      worker: null,
      isDownloading: true,
      isRemoving: false,
      downloadProgress: totalTiles > 0 ? initialCompleted / totalTiles : 0,
      tileStats: { completed: initialCompleted, total: totalTiles }
    };
    this.tasks.set(mapId, task);
    this.notifySubscribers(mapId);

    if (typeof Worker !== 'undefined') {
      const worker = new Worker(new URL('../workers/tileWorker.ts', import.meta.url), { type: 'module' });
      task.worker = worker;

      worker.postMessage({
        type: 'start-download',
        mapId,
        tiles: tilesList,
        bbox,
        pins,
        totalTiles
      });

      worker.onmessage = (e) => {
        const currentTask = this.tasks.get(mapId);
        if (!currentTask || currentTask.worker !== worker) {
          worker.terminate();
          return;
        }

        const { type, progress, error, total, completed } = e.data;
        if (type === 'progress') {
          const actualTotal = total || totalTiles;
          const actualCompleted = completed !== undefined ? completed : Math.round(progress * actualTotal);
          currentTask.downloadProgress = progress;
          currentTask.tileStats = { total: actualTotal, completed: actualCompleted };
          this.notifySubscribers(mapId);
        } else if (type === 'complete') {
          const actualTotal = total || totalTiles;
          currentTask.isDownloading = false;
          currentTask.downloadProgress = null;
          currentTask.tileStats = { total: actualTotal, completed: actualTotal };
          getOfflineMap(mapId).then((offlineMap) => {
            if (offlineMap) {
              offlineMap.totalTiles = actualTotal;
              offlineMap.completedTiles = actualTotal;
              offlineMap.isDownloaded = true;
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

    // Check manifest stats in DB
    const stats = await getManifestStats(mapId);
    if (stats.total > 0 && stats.completed < stats.total) {
      const offlineMap = await getOfflineMap(mapId);
      const bbox = offlineMap?.pins ? getPinsBoundingBox(offlineMap.pins) : null;
      this.startDownload(mapId, { bbox, pins: offlineMap?.pins, totalTiles: stats.total });
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
      tileStats: null
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
            if (currentTask && currentTask.worker === worker) {
              currentTask.isDownloading = false;
              currentTask.isRemoving = false;
              currentTask.downloadProgress = null;
              currentTask.tileStats = null;
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
        removeMapDownload(mapId).finally(() => {
          const currentTask = this.tasks.get(mapId);
          if (currentTask) {
            currentTask.isDownloading = false;
            currentTask.isRemoving = false;
            currentTask.downloadProgress = null;
            currentTask.tileStats = null;
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

    await removeAllDownloads();

    for (const mapId of mapIds) {
      this.subscribers.forEach(cb => cb({
        mapId,
        isDownloading: false,
        isRemoving: false,
        isDownloaded: false,
        hasPartialDownload: false,
        downloadProgress: null,
        tileStats: null
      }));
    }
  }
}

export const tileWorkerManager = new TileWorkerManager();

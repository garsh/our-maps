import { removeMapDownload, getManifestEntries, getManifestStats, type TileInfo } from './tileUtils';

export interface DownloadProgressState {
  mapId: string;
  isDownloading: boolean;
  isDownloaded: boolean;
  hasPartialDownload: boolean;
  downloadProgress: number | null;
  tileStats: { completed: number; total: number } | null;
}

type ProgressCallback = (state: DownloadProgressState) => void;

class TileWorkerManager {
  private activeMapId: string | null = null;
  private activeWorker: Worker | null = null;
  private isDownloading = false;
  private downloadProgress: number | null = null;
  private tileStats: { completed: number; total: number } | null = null;
  private subscribers = new Set<ProgressCallback>();

  public getActiveMapId(): string | null {
    return this.activeMapId;
  }

  public getStatus(mapId: string | null): DownloadProgressState | null {
    if (!mapId) return null;
    if (this.activeMapId === mapId) {
      return {
        mapId,
        isDownloading: this.isDownloading,
        isDownloaded: !this.isDownloading && this.downloadProgress === null && (this.tileStats?.completed === this.tileStats?.total && (this.tileStats?.total || 0) > 0),
        hasPartialDownload: !this.isDownloading && (this.tileStats?.completed || 0) < (this.tileStats?.total || 0) && (this.tileStats?.total || 0) > 0,
        downloadProgress: this.downloadProgress,
        tileStats: this.tileStats
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

  private notifySubscribers() {
    if (!this.activeMapId) return;
    const state: DownloadProgressState = {
      mapId: this.activeMapId,
      isDownloading: this.isDownloading,
      isDownloaded: !this.isDownloading && this.downloadProgress === null && (this.tileStats?.completed === this.tileStats?.total && (this.tileStats?.total || 0) > 0),
      hasPartialDownload: !this.isDownloading && (this.tileStats?.completed || 0) < (this.tileStats?.total || 0) && (this.tileStats?.total || 0) > 0,
      downloadProgress: this.downloadProgress,
      tileStats: this.tileStats
    };
    this.subscribers.forEach(cb => cb(state));
  }

  public startDownload(mapId: string, tiles: TileInfo[]) {
    // If worker is running for another map, terminate it
    if (this.activeWorker) {
      this.activeWorker.terminate();
      this.activeWorker = null;
    }

    this.activeMapId = mapId;
    this.isDownloading = true;
    this.downloadProgress = 0;
    const totalTiles = tiles.length;
    this.tileStats = { completed: 0, total: totalTiles };
    this.notifySubscribers();

    const worker = new Worker(new URL('../workers/tileWorker.ts', import.meta.url), { type: 'module' });
    this.activeWorker = worker;

    worker.postMessage({
      type: 'start-download',
      mapId,
      tiles
    });

    worker.onmessage = (e) => {
      const { type, progress, error } = e.data;
      if (type === 'progress') {
        this.downloadProgress = progress;
        this.tileStats = { total: totalTiles, completed: Math.round(progress * totalTiles) };
        this.notifySubscribers();
      } else if (type === 'complete') {
        this.isDownloading = false;
        this.downloadProgress = null;
        this.tileStats = { total: totalTiles, completed: totalTiles };
        this.notifySubscribers();
        worker.terminate();
        if (this.activeWorker === worker) {
          this.activeWorker = null;
        }
      } else if (type === 'error') {
        console.error("Worker error:", error);
        this.isDownloading = false;
        this.downloadProgress = null;
        this.notifySubscribers();
        worker.terminate();
        if (this.activeWorker === worker) {
          this.activeWorker = null;
        }
      }
    };
  }

  public async resumeIfNeeded(mapId: string) {
    // If already downloading this map, don't restart worker, just notify subscribers
    if (this.activeMapId === mapId && this.isDownloading && this.activeWorker) {
      this.notifySubscribers();
      return;
    }

    // Check manifest stats in DB
    const stats = await getManifestStats(mapId);
    if (stats.total > 0 && stats.completed < stats.total) {
      const entries = await getManifestEntries(mapId);
      if (entries.length > 0) {
        this.startDownload(mapId, entries as any);
      }
    }
  }

  public async cancelDownload(mapId: string) {
    if (this.activeMapId === mapId && this.activeWorker) {
      this.activeWorker.terminate();
      this.activeWorker = null;
    }

    if (this.activeMapId === mapId) {
      this.isDownloading = false;
      this.downloadProgress = null;
      this.tileStats = null;
      this.notifySubscribers();
      this.activeMapId = null;
    }

    await removeMapDownload(mapId);
  }
}

export const tileWorkerManager = new TileWorkerManager();

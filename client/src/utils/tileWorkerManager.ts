import { removeMapDownload, getManifestEntries, getManifestStats, type TileInfo, type BoundingBox } from './tileUtils';
import type { Pin } from '@shared/interfaces';

export interface DownloadProgressState {
  mapId: string;
  isDownloading: boolean;
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

class TileWorkerManager {
  private activeMapId: string | null = null;
  private activeWorker: Worker | null = null;
  private isDownloading = false;
  private downloadProgress: number | null = null;
  private tileStats: { completed: number; total: number } | null = null;
  private subscribers = new Set<ProgressCallback>();

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

  public async startDownload(mapId: string, params: TileInfo[] | StartDownloadParams) {
    // If worker is already downloading this map, don't restart it
    if (this.activeMapId === mapId && this.isDownloading && this.activeWorker) {
      this.notifySubscribers();
      return;
    }

    // If worker is running for another map, terminate it
    if (this.activeWorker) {
      this.activeWorker.terminate();
      this.activeWorker = null;
    }

    this.activeMapId = mapId;
    this.isDownloading = true;

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
      if (stats.completed > 0) {
        initialCompleted = stats.completed;
      }
    }
    this.downloadProgress = totalTiles > 0 ? initialCompleted / totalTiles : 0;
    this.tileStats = { completed: initialCompleted, total: totalTiles };
    this.notifySubscribers();

    const worker = new Worker(new URL('../workers/tileWorker.ts', import.meta.url), { type: 'module' });
    this.activeWorker = worker;

    worker.postMessage({
      type: 'start-download',
      mapId,
      tiles: tilesList,
      bbox,
      pins,
      totalTiles
    });

    worker.onmessage = (e) => {
      const { type, progress, error, total, completed } = e.data;
      if (type === 'progress') {
        const actualTotal = total || totalTiles;
        const actualCompleted = completed !== undefined ? completed : Math.round(progress * actualTotal);
        this.downloadProgress = progress;
        this.tileStats = { total: actualTotal, completed: actualCompleted };
        this.notifySubscribers();
      } else if (type === 'complete') {
        const actualTotal = total || totalTiles;
        this.isDownloading = false;
        this.downloadProgress = null;
        this.tileStats = { total: actualTotal, completed: actualTotal };
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

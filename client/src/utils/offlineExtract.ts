import { PMTiles } from 'pmtiles';
import { getExtractFile, invalidateExtractCache } from './extractStore';

let activeMapId: string | null = null;
const pmtCache = new Map<string, PMTiles>();
const pmtInflight = new Map<string, Promise<PMTiles | null>>();

export function setActiveOfflineMapId(mapId: string | null): void {
  activeMapId = mapId;
}

export async function preloadExtract(mapId: string): Promise<PMTiles | null> {
  setActiveOfflineMapId(mapId);
  return getActiveExtractPMTiles();
}

export function invalidateExtractPMTiles(mapId?: string): void {
  if (mapId) {
    pmtCache.delete(mapId);
    pmtInflight.delete(mapId);
    invalidateExtractCache(mapId);
  } else {
    pmtCache.clear();
    pmtInflight.clear();
    invalidateExtractCache();
  }
}

export async function getExtractTileJSON(sourceUrl: string): Promise<{
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number];
} | null> {
  const local = await getActiveExtractPMTiles();
  if (!local) return null;
  const header = await local.getHeader();
  return {
    tiles: [`${sourceUrl}/{z}/{x}/{y}`],
    minzoom: header.minZoom,
    maxzoom: header.maxZoom,
    // World bounds so MapLibre still requests tiles if the camera has not
    // yet fitted the pin bbox. Missing tiles throw and overzoom.
    bounds: [-180, -85, 180, 85],
  };
}

export async function getActiveExtractPMTiles(): Promise<PMTiles | null> {
  if (!activeMapId) return null;
  const cached = pmtCache.get(activeMapId);
  if (cached) return cached;
  const inflight = pmtInflight.get(activeMapId);
  if (inflight) return inflight;

  const mapId = activeMapId;
  const pending = (async () => {
    const file = await getExtractFile(mapId);
    if (!file) return null;
    try {
      const pmt = new PMTiles(new ExtractFileSource(file, mapId));
      await pmt.getHeader();
      pmtCache.set(mapId, pmt);
      return pmt;
    } catch {
      return null;
    }
  })();

  pmtInflight.set(mapId, pending);
  try {
    return await pending;
  } finally {
    pmtInflight.delete(mapId);
  }
}

class ExtractFileSource {
  file: File;
  mapId: string;

  constructor(file: File, mapId: string) {
    this.file = file;
    this.mapId = mapId;
  }

  getKey(): string {
    return `offline-extract:${this.mapId}`;
  }

  async getBytes(offset: number, length: number): Promise<{ data: ArrayBuffer }> {
    const blob = this.file.slice(offset, offset + length);
    const data = await blob.arrayBuffer();
    return { data };
  }
}

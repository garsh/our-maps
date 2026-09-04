import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PMTiles } from 'pmtiles';
import { resolveSafeMapFile } from './mapFiles';
import { planExtract, streamPlannedExtract, type BoundingBox, type ExtractPlan } from './pmtilesExtract';

class LocalFileSource {
  private fd: number;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, 'r');
  }

  getKey(): string {
    return this.filePath;
  }

  async getBytes(offset: number, length: number): Promise<{ data: ArrayBuffer }> {
    const buffer = Buffer.allocUnsafe(length);
    fs.readSync(this.fd, buffer, 0, length, offset);
    return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer };
  }
}

let cachedPMTiles: PMTiles | null = null;
let cachedPMTilesPath: string | null = null;

// Cache computed ExtractPlans by (bbox, startZoom, endZoom) key.
// planExtract takes several seconds for large extracts; the result is deterministic
// for identical inputs, so we reuse it across concurrent/sequential requests.
// We maintain both an in-memory cache and a disk-persisted cache in `.plan_cache/`
// so that when a download resumes (even after server restarts or network drops),
// the plan loads from disk in ~1ms rather than re-running a 6-10 second CPU calculation.
const planCache = new Map<string, ExtractPlan>();
// In-flight deduplication: if two requests arrive for the same key while a
// planExtract is already running, the second waits on the same Promise instead
// of starting an independent computation (which would double memory/CPU usage).
const pendingPlanCache = new Map<string, Promise<ExtractPlan>>();
const PLAN_CACHE_MAX = 5;
const DISK_CACHE_MAX_ENTRIES = 20;
const DISK_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SerializedExtractPlan {
  version: 1;
  headerBytes: string;
  rootBytes: string;
  metadataBytes: string;
  leavesBytes: string;
  ranges: Array<{ srcOffset: number; dstOffset: number; length: number }>;
  sourceTileDataOffset: number;
  addressedTiles: number;
  totalBytes: number;
  sourceMtime?: number;
  sourceSize?: number;
}

function getPlanCacheKey(bbox: BoundingBox, startZoom: number, endZoom: number): string {
  return JSON.stringify({
    n: bbox.north, s: bbox.south, e: bbox.east, w: bbox.west,
    z0: startZoom, z1: endZoom,
  });
}

function getPlanCacheDir(baseDir?: string): string {
  return baseDir
    ? path.join(baseDir, '.plan_cache')
    : path.resolve(process.cwd(), 'data/maps/.plan_cache');
}

function getPlanCacheFilePath(key: string, baseDir?: string): string {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(getPlanCacheDir(baseDir), `${hash}.json`);
}

/**
 * Prunes the disk plan cache by:
 * 1. Removing entries older than maxAgeMs (default 7 days)
 * 2. Enforcing an LRU cap of maxEntries (default 20), deleting oldest accessed plans
 */
export function cleanupPlanDiskCache(baseDir?: string, maxEntries = DISK_CACHE_MAX_ENTRIES, maxAgeMs = DISK_CACHE_MAX_AGE_MS): void {
  try {
    const cacheDir = getPlanCacheDir(baseDir);
    if (!fs.existsSync(cacheDir)) return;

    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
    const now = Date.now();
    const fileStats: Array<{ name: string; fullPath: string; mtimeMs: number }> = [];

    for (const file of files) {
      const fullPath = path.join(cacheDir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          continue;
        }
        fileStats.push({ name: file, fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignore errors on individual files during cleanup
      }
    }

    if (fileStats.length > maxEntries) {
      // Sort oldest first (smallest mtimeMs) and remove excess
      fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const toRemove = fileStats.slice(0, fileStats.length - maxEntries);
      for (const item of toRemove) {
        try {
          fs.unlinkSync(item.fullPath);
        } catch {
          // Ignore
        }
      }
    }
  } catch (err) {
    console.warn('[TILE_STREAM_SERVER] Error cleaning plan disk cache:', err);
  }
}

function readPlanFromDisk(key: string, baseDir?: string, sourceFilePath?: string): ExtractPlan | null {
  try {
    const filePath = getPlanCacheFilePath(key, baseDir);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed: SerializedExtractPlan = JSON.parse(raw);
    if (parsed.version !== 1) return null;

    // Source dataset invalidation: if planet.pmtiles changed, invalidate cache
    if (sourceFilePath && fs.existsSync(sourceFilePath)) {
      try {
        const stat = fs.statSync(sourceFilePath);
        if (parsed.sourceMtime && parsed.sourceMtime !== stat.mtimeMs) {
          console.log('[TILE_STREAM_SERVER] Invaliding plan cache (planet.pmtiles modified)');
          fs.unlinkSync(filePath);
          return null;
        }
        if (parsed.sourceSize && parsed.sourceSize !== stat.size) {
          console.log('[TILE_STREAM_SERVER] Invaliding plan cache (planet.pmtiles size changed)');
          fs.unlinkSync(filePath);
          return null;
        }
      } catch {
        // Non-fatal stat error
      }
    }

    // Touch file modification time for LRU tracking
    try {
      const now = new Date();
      fs.utimesSync(filePath, now, now);
    } catch {
      // Non-fatal
    }

    return {
      headerBytes: Buffer.from(parsed.headerBytes, 'base64'),
      rootBytes: Buffer.from(parsed.rootBytes, 'base64'),
      metadataBytes: Buffer.from(parsed.metadataBytes, 'base64'),
      leavesBytes: Buffer.from(parsed.leavesBytes, 'base64'),
      ranges: parsed.ranges,
      sourceTileDataOffset: parsed.sourceTileDataOffset,
      addressedTiles: parsed.addressedTiles,
      totalBytes: parsed.totalBytes,
    };
  } catch (err) {
    console.warn('[TILE_STREAM_SERVER] Failed to read cached plan from disk:', err);
    return null;
  }
}

function savePlanToDisk(key: string, plan: ExtractPlan, baseDir?: string, sourceFilePath?: string): void {
  try {
    const filePath = getPlanCacheFilePath(key, baseDir);
    const cacheDir = path.dirname(filePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    let sourceMtime: number | undefined;
    let sourceSize: number | undefined;
    if (sourceFilePath && fs.existsSync(sourceFilePath)) {
      try {
        const stat = fs.statSync(sourceFilePath);
        sourceMtime = stat.mtimeMs;
        sourceSize = stat.size;
      } catch {
        // Non-fatal
      }
    }

    const serialized: SerializedExtractPlan = {
      version: 1,
      headerBytes: plan.headerBytes.toString('base64'),
      rootBytes: plan.rootBytes.toString('base64'),
      metadataBytes: plan.metadataBytes.toString('base64'),
      leavesBytes: plan.leavesBytes.toString('base64'),
      ranges: plan.ranges,
      sourceTileDataOffset: plan.sourceTileDataOffset,
      addressedTiles: plan.addressedTiles,
      totalBytes: plan.totalBytes,
      sourceMtime,
      sourceSize,
    };
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(serialized));
    fs.renameSync(tmpPath, filePath);

    // Run eviction to keep within the LRU cap
    cleanupPlanDiskCache(baseDir);
  } catch (err) {
    console.warn('[TILE_STREAM_SERVER] Failed to save plan to disk cache:', err);
  }
}

async function getCachedPlan(
  pmt: PMTiles,
  bbox: BoundingBox,
  startZoom: number,
  endZoom: number,
  tag: string,
  baseDir?: string,
  sourceFilePath?: string
): Promise<ExtractPlan> {
  const key = getPlanCacheKey(bbox, startZoom, endZoom);

  // 1. In-memory cache hit
  const memCached = planCache.get(key);
  if (memCached) {
    console.log(`${tag}[TILE_STREAM_SERVER] In-memory plan cache HIT: totalBytes=${memCached.totalBytes}, tiles=${memCached.addressedTiles}`);
    return memCached;
  }

  // 2. Persistent disk cache hit (fast: ~1ms load from disk, survives server restarts)
  const diskCached = readPlanFromDisk(key, baseDir, sourceFilePath);
  if (diskCached) {
    console.log(`${tag}[TILE_STREAM_SERVER] Disk plan cache HIT: totalBytes=${diskCached.totalBytes}, tiles=${diskCached.addressedTiles}`);
    if (planCache.size >= PLAN_CACHE_MAX) {
      planCache.delete(planCache.keys().next().value!);
    }
    planCache.set(key, diskCached);
    return diskCached;
  }

  // 3. In-flight deduplication: attach to existing computation instead of starting another
  const pending = pendingPlanCache.get(key);
  if (pending) {
    console.log(`${tag}[TILE_STREAM_SERVER] Plan already in-flight, awaiting shared computation...`);
    return pending;
  }

  // 4. Start a new computation and register it so concurrent callers can share it
  const planPromise = (async () => {
    const planStart = Date.now();
    try {
      const plan = await planExtract(pmt, bbox, startZoom, endZoom);
      console.log(`${tag}[TILE_STREAM_SERVER] Plan computed in ${Date.now() - planStart}ms: totalBytes=${plan.totalBytes}, tiles=${plan.addressedTiles}, ranges=${plan.ranges.length}`);
      if (planCache.size >= PLAN_CACHE_MAX) {
        planCache.delete(planCache.keys().next().value!);
      }
      planCache.set(key, plan);
      savePlanToDisk(key, plan, baseDir, sourceFilePath);
      return plan;
    } finally {
      pendingPlanCache.delete(key);
    }
  })();

  pendingPlanCache.set(key, planPromise);
  return planPromise;
}


function getPMTilesInstance(candidateDirs: string[]): { pmt: PMTiles; filePath: string } | null {
  const filePath = resolveSafeMapFile('planet.pmtiles', candidateDirs);
  if (!filePath || !fs.existsSync(filePath)) return null;

  if (!cachedPMTiles || cachedPMTilesPath !== filePath) {
    const source = new LocalFileSource(filePath);
    cachedPMTiles = new PMTiles(source);
    cachedPMTilesPath = filePath;
  }
  return { pmt: cachedPMTiles, filePath };
}

function writeChunk(res: Response, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (res.writableEnded || res.destroyed) {
      resolve();
      return;
    }
    const ok = res.write(chunk);
    if (ok) {
      resolve();
      return;
    }
    const onDrain = () => {
      res.off('error', onError);
      resolve();
    };
    const onError = (err: Error) => {
      res.off('drain', onDrain);
      reject(err);
    };
    res.once('drain', onDrain);
    res.once('error', onError);
  });
}

function parseExtractRequest(req: Request): { bbox: BoundingBox; startZoom: number; endZoom: number } | { error: string } {
  const { bbox, minZoom = 1, maxZoom = 15 } = req.body || {};
  if (!bbox || typeof bbox.north !== 'number' || typeof bbox.south !== 'number' ||
      typeof bbox.east !== 'number' || typeof bbox.west !== 'number') {
    return { error: 'Valid bbox { north, south, east, west } is required' };
  }
  const startZoom = Math.max(1, Math.min(15, Number(minZoom) || 1));
  const endZoom = Math.max(startZoom, Math.min(15, Number(maxZoom) || 15));
  return {
    bbox: {
      north: bbox.north,
      south: bbox.south,
      east: bbox.east,
      west: bbox.west,
    },
    startZoom,
    endZoom,
  };
}

export function parseExtractResumeOffset(req: Request): number {
  const bodyOffset = Number((req.body || {}).offset);
  if (Number.isFinite(bodyOffset) && bodyOffset > 0) {
    return Math.floor(bodyOffset);
  }
  const range = req.headers?.range;
  const rangeHeader = Array.isArray(range) ? range[0] : range;
  if (typeof rangeHeader === 'string') {
    const match = /^bytes=(\d+)-$/i.exec(rangeHeader.trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return 0;
}

export async function handleExtractSize(req: Request, res: Response, candidateMapsDirs: string[]) {
  const startTime = Date.now();
  const parsed = parseExtractRequest(req);
  if ('error' in parsed) {
    console.warn(`[TILE_STREAM_SERVER] Size estimation failed: ${parsed.error}`);
    return res.status(400).json({ error: parsed.error });
  }

  const archive = getPMTilesInstance(candidateMapsDirs);
  if (!archive) {
    console.warn('[TILE_STREAM_SERVER] Size estimation failed: planet.pmtiles not found');
    return res.status(404).json({ error: 'planet.pmtiles map dataset not found' });
  }

  try {
    await archive.pmt.getHeader();
    console.log(`[TILE_STREAM_SERVER] Estimating extract size for bbox: ${JSON.stringify(parsed.bbox)}, zooms: ${parsed.startZoom}-${parsed.endZoom}`);
    const plan = await getCachedPlan(archive.pmt, parsed.bbox, parsed.startZoom, parsed.endZoom, '', path.dirname(archive.filePath), archive.filePath);
    console.log(`[TILE_STREAM_SERVER] Size estimated in ${Date.now() - startTime}ms: bytes=${plan.totalBytes}, tiles=${plan.addressedTiles}`);
    return res.json({
      bytes: plan.totalBytes,
      addressedTiles: plan.addressedTiles,
      minZoom: parsed.startZoom,
      maxZoom: parsed.endZoom,
    });
  } catch (err) {
    console.error(`[TILE_STREAM_SERVER] Failed to estimate map extract size:`, err);
    return res.status(500).json({ error: 'Failed to estimate map extract size' });
  }
}

export async function handleTileStream(req: Request, res: Response, candidateMapsDirs: string[]) {
  const reqStart = Date.now();
  const parsed = parseExtractRequest(req);
  if ('error' in parsed) {
    console.warn(`[TILE_STREAM_SERVER] Stream request rejected: ${parsed.error}`);
    return res.status(400).json({ error: parsed.error });
  }

  const archive = getPMTilesInstance(candidateMapsDirs);
  if (!archive) {
    console.warn('[TILE_STREAM_SERVER] Stream failed: planet.pmtiles map dataset not found');
    return res.status(404).json({ error: 'planet.pmtiles map dataset not found' });
  }

  const { pmt, filePath } = archive;
  try {
    await pmt.getHeader();
  } catch (err) {
    console.error('[TILE_STREAM_SERVER] Failed to read PMTiles header:', err);
    return res.status(500).json({ error: 'Failed to read PMTiles header' });
  }

  const { bbox: extractBbox, startZoom, endZoom } = parsed;
  const rawResumeOffset = parseExtractResumeOffset(req);
  const mapIdTag = (req.body && req.body.mapId) ? `[mapId=${req.body.mapId}] ` : '';

  console.log(`${mapIdTag}[TILE_STREAM_SERVER] New stream request received: rawResumeOffset=${rawResumeOffset} bytes, bbox=${JSON.stringify(extractBbox)}, zooms=${startZoom}-${endZoom}`);

  let isAborted = false;
  req.on('close', () => {
    isAborted = true;
    console.log(`${mapIdTag}[TILE_STREAM_SERVER] Client closed connection / aborted after ${Date.now() - reqStart}ms`);
  });

  try {
    const plan = await getCachedPlan(pmt, extractBbox, startZoom, endZoom, mapIdTag, path.dirname(filePath), filePath);

    if (isAborted) {
      console.log(`${mapIdTag}[TILE_STREAM_SERVER] Request was aborted during planning phase`);
      return;
    }

    const offset = Math.min(rawResumeOffset, plan.totalBytes);
    if (offset >= plan.totalBytes && plan.totalBytes > 0) {
      console.warn(`${mapIdTag}[TILE_STREAM_SERVER] Resume offset (${offset}) >= totalBytes (${plan.totalBytes}). Returning 416 Range Not Satisfiable`);
      res.setHeader('Content-Range', `bytes */${plan.totalBytes}`);
      res.setHeader('X-Extract-Bytes', plan.totalBytes.toString());
      return res.status(416).json({ error: 'Range not satisfiable', bytes: plan.totalBytes });
    }

    const remaining = plan.totalBytes - offset;
    if (offset > 0) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${offset}-${plan.totalBytes - 1}/${plan.totalBytes}`);
      console.log(`${mapIdTag}[TILE_STREAM_SERVER] Resuming stream (206 Partial Content) from byte ${offset} of ${plan.totalBytes} (${remaining} bytes remaining)`);
    } else {
      console.log(`${mapIdTag}[TILE_STREAM_SERVER] Starting fresh stream (200 OK) for ${plan.totalBytes} bytes`);
    }
    res.setHeader('Content-Type', 'application/vnd.pmtiles');
    res.setHeader('Content-Length', remaining.toString());
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Total-Tiles', plan.addressedTiles.toString());
    res.setHeader('X-Extract-Bytes', plan.totalBytes.toString());
    res.setHeader('X-Extract-Offset', offset.toString());

    let bytesStreamedThisConn = 0;
    let lastLoggedTime = Date.now();
    let lastLoggedBytes = 0;

    await streamPlannedExtract(
      filePath,
      plan,
      async (chunk) => {
        await writeChunk(res, chunk);
        bytesStreamedThisConn += chunk.length;
        const now = Date.now();
        if (now - lastLoggedTime >= 3000) {
          const intervalSec = (now - lastLoggedTime) / 1000;
          const intervalBytes = bytesStreamedThisConn - lastLoggedBytes;
          const speedKBps = Math.round((intervalBytes / 1024) / intervalSec);
          const currentTotal = offset + bytesStreamedThisConn;
          const pct = plan.totalBytes > 0 ? ((currentTotal / plan.totalBytes) * 100).toFixed(1) : '?';
          console.log(`${mapIdTag}[TILE_STREAM_SERVER] Streaming: ${currentTotal}/${plan.totalBytes} bytes (${pct}%) at ${speedKBps} KB/s`);
          lastLoggedTime = now;
          lastLoggedBytes = bytesStreamedThisConn;
        }
      },
      () => isAborted,
      offset
    );

    if (!isAborted && !res.writableEnded) {
      console.log(`${mapIdTag}[TILE_STREAM_SERVER] Finished streaming successfully: sent ${bytesStreamedThisConn} bytes in ${Date.now() - reqStart}ms`);
      res.end();
    }
  } catch (err) {
    if (isAborted) return;
    console.error(`${mapIdTag}[TILE_STREAM_SERVER] Error during streaming:`, err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to build map extract' });
    }
    res.destroy(err instanceof Error ? err : new Error('Failed to build map extract'));
  }
}

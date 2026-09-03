import { Request, Response } from 'express';
import fs from 'fs';
import { PMTiles } from 'pmtiles';
import { resolveSafeMapFile } from './mapFiles';
import { planExtract, streamPlannedExtract, type BoundingBox } from './pmtilesExtract';

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
  const parsed = parseExtractRequest(req);
  if ('error' in parsed) {
    return res.status(400).json({ error: parsed.error });
  }

  const archive = getPMTilesInstance(candidateMapsDirs);
  if (!archive) {
    return res.status(404).json({ error: 'planet.pmtiles map dataset not found' });
  }

  try {
    await archive.pmt.getHeader();
    const plan = await planExtract(archive.pmt, parsed.bbox, parsed.startZoom, parsed.endZoom);
    return res.json({
      bytes: plan.totalBytes,
      addressedTiles: plan.addressedTiles,
      minZoom: parsed.startZoom,
      maxZoom: parsed.endZoom,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to estimate map extract size' });
  }
}

export async function handleTileStream(req: Request, res: Response, candidateMapsDirs: string[]) {
  const parsed = parseExtractRequest(req);
  if ('error' in parsed) {
    return res.status(400).json({ error: parsed.error });
  }

  const archive = getPMTilesInstance(candidateMapsDirs);
  if (!archive) {
    return res.status(404).json({ error: 'planet.pmtiles map dataset not found' });
  }

  const { pmt, filePath } = archive;
  try {
    await pmt.getHeader();
  } catch {
    return res.status(500).json({ error: 'Failed to read PMTiles header' });
  }

  const { bbox: extractBbox, startZoom, endZoom } = parsed;

  let isAborted = false;
  req.on('close', () => {
    isAborted = true;
  });

  try {
    const plan = await planExtract(pmt, extractBbox, startZoom, endZoom);

    if (isAborted) return;

    const offset = Math.min(parseExtractResumeOffset(req), plan.totalBytes);
    if (offset >= plan.totalBytes && plan.totalBytes > 0) {
      res.setHeader('Content-Range', `bytes */${plan.totalBytes}`);
      res.setHeader('X-Extract-Bytes', plan.totalBytes.toString());
      return res.status(416).json({ error: 'Range not satisfiable', bytes: plan.totalBytes });
    }

    const remaining = plan.totalBytes - offset;
    if (offset > 0) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${offset}-${plan.totalBytes - 1}/${plan.totalBytes}`);
    }
    res.setHeader('Content-Type', 'application/vnd.pmtiles');
    res.setHeader('Content-Length', remaining.toString());
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Total-Tiles', plan.addressedTiles.toString());
    res.setHeader('X-Extract-Bytes', plan.totalBytes.toString());
    res.setHeader('X-Extract-Offset', offset.toString());

    await streamPlannedExtract(
      filePath,
      plan,
      (chunk) => writeChunk(res, chunk),
      () => isAborted,
      offset
    );

    if (!isAborted && !res.writableEnded) {
      res.end();
    }
  } catch (err) {
    if (isAborted) return;
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to build map extract' });
    }
    res.destroy(err instanceof Error ? err : new Error('Failed to build map extract'));
  }
}

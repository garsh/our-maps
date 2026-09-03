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

export async function handleTileStream(req: Request, res: Response, candidateMapsDirs: string[]) {
  const { bbox, minZoom = 1, maxZoom = 15 } = req.body || {};

  if (!bbox || typeof bbox.north !== 'number' || typeof bbox.south !== 'number' ||
      typeof bbox.east !== 'number' || typeof bbox.west !== 'number') {
    return res.status(400).json({ error: 'Valid bbox { north, south, east, west } is required' });
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

  const startZoom = Math.max(1, Math.min(15, Number(minZoom) || 1));
  const endZoom = Math.max(startZoom, Math.min(15, Number(maxZoom) || 15));
  const extractBbox: BoundingBox = {
    north: bbox.north,
    south: bbox.south,
    east: bbox.east,
    west: bbox.west,
  };

  let isAborted = false;
  req.on('close', () => {
    isAborted = true;
  });

  try {
    const plan = await planExtract(pmt, extractBbox, startZoom, endZoom);

    if (isAborted) return;

    res.setHeader('Content-Type', 'application/vnd.pmtiles');
    res.setHeader('Content-Length', plan.totalBytes.toString());
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Total-Tiles', plan.addressedTiles.toString());
    res.setHeader('X-Extract-Bytes', plan.totalBytes.toString());

    await streamPlannedExtract(
      filePath,
      plan,
      (chunk) => writeChunk(res, chunk),
      () => isAborted
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

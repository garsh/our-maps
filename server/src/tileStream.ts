import { Request, Response } from 'express';
import fs from 'fs';
import { PMTiles } from 'pmtiles';
import { resolveSafeMapFile } from './mapFiles';

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
    return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  }
}

let cachedPMTiles: PMTiles | null = null;
let cachedPMTilesPath: string | null = null;

function getPMTilesInstance(candidateDirs: string[]): PMTiles | null {
  const filePath = resolveSafeMapFile('planet.pmtiles', candidateDirs);
  if (!filePath || !fs.existsSync(filePath)) return null;

  if (!cachedPMTiles || cachedPMTilesPath !== filePath) {
    const source = new LocalFileSource(filePath);
    cachedPMTiles = new PMTiles(source);
    cachedPMTilesPath = filePath;
  }
  return cachedPMTiles;
}

function longToX(lon: number, zoom: number): number {
  const x = Math.floor(((lon + 180.0) / 360.0) * (1 << zoom));
  return ((x % (1 << zoom)) + (1 << zoom)) % (1 << zoom);
}

function latToY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180.0;
  const y = Math.floor(((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0) * (1 << zoom));
  return Math.max(0, Math.min((1 << zoom) - 1, y));
}

function getXRanges(west: number, east: number, zoom: number): Array<[number, number]> {
  const xMin = longToX(west, zoom);
  const xMax = longToX(east, zoom);
  const maxTile = (1 << zoom) - 1;
  if (west <= east) {
    return [[Math.min(xMin, xMax), Math.max(xMin, xMax)]];
  } else {
    // Crossing the antimeridian
    return [
      [xMin, maxTile],
      [0, xMax]
    ];
  }
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export async function handleTileStream(req: Request, res: Response, candidateMapsDirs: string[]) {
  const { bbox, minZoom = 1, maxZoom = 15 } = req.body || {};

  if (!bbox || typeof bbox.north !== 'number' || typeof bbox.south !== 'number' ||
      typeof bbox.east !== 'number' || typeof bbox.west !== 'number') {
    return res.status(400).json({ error: 'Valid bbox { north, south, east, west } is required' });
  }

  const pmt = getPMTilesInstance(candidateMapsDirs);
  if (!pmt) {
    return res.status(404).json({ error: 'planet.pmtiles map dataset not found' });
  }

  try {
    await pmt.getHeader();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read PMTiles header' });
  }

  const startZoom = Math.max(1, Math.min(15, Number(minZoom) || 1));
  const endZoom = Math.max(startZoom, Math.min(15, Number(maxZoom) || 15));

  // Build tile coordinate array
  const tiles: Array<{ z: number; x: number; y: number }> = [];
  for (let z = startZoom; z <= endZoom; z++) {
    const yMin = latToY(bbox.north, z);
    const yMax = latToY(bbox.south, z);
    const yStart = Math.min(yMin, yMax);
    const yEnd = Math.max(yMin, yMax);

    const xRanges = getXRanges(bbox.west, bbox.east, z);
    for (const [xStart, xEnd] of xRanges) {
      for (let x = xStart; x <= xEnd; x++) {
        for (let y = yStart; y <= yEnd; y++) {
          tiles.push({ z, x, y });
        }
      }
    }
  }

  // Set binary stream headers
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Total-Tiles', tiles.length.toString());

  let isAborted = false;
  req.on('close', () => {
    isAborted = true;
  });

  const CONCURRENCY = 32;
  let queueIndex = 0;

  const workers = Array(CONCURRENCY).fill(null).map(async () => {
    while (queueIndex < tiles.length && !isAborted) {
      const tile = tiles[queueIndex++];
      if (!tile) break;

      try {
        const result = await pmt.getZxy(tile.z, tile.x, tile.y);
        const dataLength = result && result.data ? result.data.byteLength : 0;

        // 13-byte header: [z (1B), x (4B uint32 BE), y (4B uint32 BE), len (4B uint32 BE)] + tile payload
        const frame = Buffer.allocUnsafe(13 + dataLength);
        frame.writeUInt8(tile.z, 0);
        frame.writeUInt32BE(tile.x, 1);
        frame.writeUInt32BE(tile.y, 5);
        frame.writeUInt32BE(dataLength, 9);

        if (dataLength > 0 && result && result.data) {
          Buffer.from(result.data).copy(frame, 13);
        }

        if (!isAborted) {
          res.write(frame);
        }
      } catch (err) {
        // Write empty frame on error so stream position remains synchronized
        const emptyFrame = Buffer.allocUnsafe(13);
        emptyFrame.writeUInt8(tile.z, 0);
        emptyFrame.writeUInt32BE(tile.x, 1);
        emptyFrame.writeUInt32BE(tile.y, 5);
        emptyFrame.writeUInt32BE(0, 9);
        if (!isAborted) {
          res.write(emptyFrame);
        }
      }
    }
  });

  await Promise.all(workers);
  if (!isAborted) {
    res.end();
  }
}

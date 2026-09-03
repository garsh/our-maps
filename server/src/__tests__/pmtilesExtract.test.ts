import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Compression, PMTiles } from 'pmtiles';
import { buildPmtilesBuffer } from '../pmtilesArchive';
import {
  collectWantedTileIds,
  rangeIntersectsWanted,
  reencodeEntries,
  relevantEntries,
  buildExtractBuffer,
  planExtract,
  getXRanges,
  streamPlannedExtract,
} from '../pmtilesExtract';
function countTilesLocal(bbox: { north: number; south: number; east: number; west: number }, minZoom: number, maxZoom: number): number {
  return collectWantedTileIds(bbox, minZoom, maxZoom).length;
}

class FileSource {
  constructor(private filePath: string) {}
  getKey() { return this.filePath; }
  async getBytes(offset: number, length: number) {
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fd, buffer, 0, length, offset);
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer };
    } finally {
      fs.closeSync(fd);
    }
  }
}

describe('pmtilesExtract', () => {
  it('matches client tile counts when collecting wanted tile IDs', () => {
    const bbox = { north: 40.75, south: 40.70, east: -73.95, west: -74.00 };
    const ids = collectWantedTileIds(bbox, 1, 15);
    expect(ids.length).toBe(countTilesLocal(bbox, 1, 15));
    expect(ids.length).toBeGreaterThan(340);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  it('includes a 2-tile buffer at zoom 6 and 1-tile buffer at zoom 9', () => {
    const bbox = { north: 40.75, south: 40.74, east: -73.98, west: -73.99 };
    expect(collectWantedTileIds(bbox, 6, 6).length).toBe(25);
    expect(collectWantedTileIds(bbox, 9, 9).length).toBe(9);
  });

  it('splits antimeridian x ranges', () => {
    const ranges = getXRanges(179, -179, 3);
    expect(ranges).toEqual([[7, 7], [0, 0]]);
  });

  it('detects Hilbert range overlap with a sorted wanted list', () => {
    const wanted = [10, 12, 15, 20];
    expect(rangeIntersectsWanted(12, 14, wanted)).toBe(true);
    expect(rangeIntersectsWanted(13, 16, wanted)).toBe(true);
    expect(rangeIntersectsWanted(16, 19, wanted)).toBe(false);
    expect(rangeIntersectsWanted(0, 10, wanted)).toBe(false);
  });

  it('trims run-length directory entries to the wanted tile IDs', () => {
    const wanted = [5, 6, 8, 9, 10];
    const { tiles, leaves } = relevantEntries(wanted, 15, [
      { tileId: 4, offset: 100, length: 10, runLength: 8 },
      { tileId: 20, offset: 0, length: 50, runLength: 0 },
    ]);
    expect(leaves).toHaveLength(0);
    expect(tiles).toEqual([
      { tileId: 5, offset: 100, length: 10, runLength: 2 },
      { tileId: 8, offset: 100, length: 10, runLength: 3 },
    ]);
  });

  it('selects overlapping leaf pointers', () => {
    const wanted = [100];
    const { tiles, leaves } = relevantEntries(wanted, 15, [
      { tileId: 0, offset: 0, length: 20, runLength: 0 },
      { tileId: 50, offset: 20, length: 20, runLength: 0 },
      { tileId: 200, offset: 1, length: 8, runLength: 1 },
    ]);
    expect(tiles).toHaveLength(0);
    expect(leaves).toEqual([{ tileId: 50, offset: 20, length: 20, runLength: 0 }]);
  });

  it('reencodes entries into clustered dest offsets and coalesces adjacent source ranges', () => {
    const { reencoded, ranges, tileDataLength, addressedTiles, tileContents } = reencodeEntries([
      { tileId: 1, offset: 100, length: 10, runLength: 1 },
      { tileId: 2, offset: 110, length: 5, runLength: 2 },
      { tileId: 5, offset: 100, length: 10, runLength: 1 },
    ]);
    expect(addressedTiles).toBe(4);
    expect(tileContents).toBe(2);
    expect(tileDataLength).toBe(15);
    expect(ranges).toEqual([{ srcOffset: 100, dstOffset: 0, length: 15 }]);
    expect(reencoded[0].offset).toBe(0);
    expect(reencoded[1].offset).toBe(10);
    expect(reencoded[2].offset).toBe(0);
  });
});

describe('pmtilesExtract integration', () => {
  let dir: string;
  let filePath: string;

  beforeAll(() => {
    const tiles = [];
    for (let z = 1; z <= 4; z++) {
      const maxTile = (1 << z) - 1;
      for (let x = 0; x <= maxTile; x++) {
        for (let y = 0; y <= maxTile; y++) {
          tiles.push({ z, x, y, data: new Uint8Array([z, x, y]) });
        }
      }
    }
    // A small cluster at zoom 5 around lon/lat 0,0
    for (let x = 15; x <= 17; x++) {
      for (let y = 15; y <= 17; y++) {
        tiles.push({ z: 5, x, y, data: new Uint8Array([5, x, y]) });
      }
    }
    // Distant tiles that a tiny equatorial bbox must not include
    tiles.push({ z: 5, x: 0, y: 0, data: new Uint8Array([5, 0, 0]) });
    tiles.push({ z: 5, x: 31, y: 31, data: new Uint8Array([5, 31, 31]) });

    const archive = buildPmtilesBuffer({
      tiles,
      minZoom: 1,
      maxZoom: 5,
      minLon: -180,
      minLat: -85,
      maxLon: 180,
      maxLat: 85,
      internalCompression: Compression.Gzip,
      tileCompression: Compression.None,
    });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-src-'));
    filePath = path.join(dir, 'planet.pmtiles');
    fs.writeFileSync(filePath, archive);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts a bbox into a smaller archive that still serves the same tiles', async () => {
    const pmt = new PMTiles(new FileSource(filePath));
    const bbox = { north: 2, south: -2, east: 2, west: -2 };
    const extracted = await buildExtractBuffer(pmt, filePath, bbox, 1, 5);
    expect(extracted.length).toBeLessThan(fs.statSync(filePath).size);

    const out = new PMTiles(new FileSource(
      (() => {
        const outPath = path.join(dir, 'extract.pmtiles');
        fs.writeFileSync(outPath, extracted);
        return outPath;
      })()
    ));

    const header = await out.getHeader();
    expect(header.minZoom).toBe(1);
    expect(header.maxZoom).toBe(5);
    expect(header.clustered).toBe(true);
    expect(header.numAddressedTiles).toBeGreaterThan(0);

    const low = await out.getZxy(1, 0, 0);
    expect(low).toBeDefined();
    expect(Array.from(new Uint8Array(low!.data))).toEqual([1, 0, 0]);

    const z5 = await out.getZxy(5, 16, 16);
    expect(z5).toBeDefined();
    expect(Array.from(new Uint8Array(z5!.data))).toEqual([5, 16, 16]);

    const plan = await planExtract(pmt, bbox, 1, 5);
    expect(plan.totalBytes).toBe(extracted.length);
    expect(plan.addressedTiles).toBe(header.numAddressedTiles);
  });

  it('streamPlannedExtract can skip a prefix of output bytes for resume', async () => {
    const pmt = new PMTiles(new FileSource(filePath));
    const bbox = { north: 2, south: -2, east: 2, west: -2 };
    const plan = await planExtract(pmt, bbox, 1, 5);
    const fullChunks: Buffer[] = [];
    await streamPlannedExtract(filePath, plan, async (chunk) => {
      fullChunks.push(Buffer.from(chunk));
    }, () => false);
    const full = Buffer.concat(fullChunks);
    expect(full.length).toBe(plan.totalBytes);

    const prefixBytes = plan.headerBytes.length + plan.rootBytes.length + plan.metadataBytes.length + plan.leavesBytes.length;
    const offset = Math.min(full.length - 1, Math.max(prefixBytes + 10, Math.floor(full.length / 3)));
    const restChunks: Buffer[] = [];
    await streamPlannedExtract(filePath, plan, async (chunk) => {
      restChunks.push(Buffer.from(chunk));
    }, () => false, offset);
    const rest = Buffer.concat(restChunks);
    expect(rest.equals(full.subarray(offset))).toBe(true);
  });

  it('keeps full-world coverage at zooms 1-4 even for a tiny bbox', async () => {
    const pmt = new PMTiles(new FileSource(filePath));
    const bbox = { north: 1, south: 0, east: 1, west: 0 };
    const extracted = await buildExtractBuffer(pmt, filePath, bbox, 1, 4);
    const outPath = path.join(dir, 'lowzoom.pmtiles');
    fs.writeFileSync(outPath, extracted);
    const out = new PMTiles(new FileSource(outPath));
    const header = await out.getHeader();
    // 4 + 16 + 64 + 256
    expect(header.numAddressedTiles).toBe(340);
    expect(await out.getZxy(4, 0, 0)).toBeDefined();
    expect(await out.getZxy(4, 15, 15)).toBeDefined();
  });
});

import fs from 'fs';
import { PMTiles, zxyToTileId, type Entry, type Header } from 'pmtiles';
import {
  HEADER_SIZE_BYTES,
  ROOT_TARGET_BYTES,
  buildDirectories,
  serializeHeader,
  type ArchiveHeader,
} from './pmtilesArchive';

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface SrcDstRange {
  srcOffset: number;
  dstOffset: number;
  length: number;
}

export interface ExtractPlan {
  headerBytes: Buffer;
  rootBytes: Buffer;
  metadataBytes: Buffer;
  leavesBytes: Buffer;
  ranges: SrcDstRange[];
  sourceTileDataOffset: number;
  addressedTiles: number;
  totalBytes: number;
}

function longToX(lon: number, zoom: number): number {
  const x = Math.floor(((lon + 180.0) / 360.0) * (1 << zoom));
  return ((x % (1 << zoom)) + (1 << zoom)) % (1 << zoom);
}

function latToY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180.0;
  const y = Math.floor(
    ((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0) * (1 << zoom)
  );
  return Math.max(0, Math.min((1 << zoom) - 1, y));
}

export function getXRanges(west: number, east: number, zoom: number, buffer = 0): Array<[number, number]> {
  const maxTile = (1 << zoom) - 1;
  const rawXMin = longToX(west, zoom) - buffer;
  const rawXMax = longToX(east, zoom) + buffer;
  if (west <= east) {
    const xMin = Math.max(0, Math.min(maxTile, Math.min(rawXMin, rawXMax)));
    const xMax = Math.max(0, Math.min(maxTile, Math.max(rawXMin, rawXMax)));
    return [[xMin, xMax]];
  }
  const xMin = Math.max(0, Math.min(maxTile, rawXMin));
  const xMax = Math.max(0, Math.min(maxTile, rawXMax));
  return [
    [xMin, maxTile],
    [0, xMax],
  ];
}

export function getYRange(north: number, south: number, zoom: number, buffer = 0): [number, number] {
  const maxTile = (1 << zoom) - 1;
  const yMin = latToY(north, zoom);
  const yMax = latToY(south, zoom);
  const yStart = Math.max(0, Math.min(yMin, yMax) - buffer);
  const yEnd = Math.min(maxTile, Math.max(yMin, yMax) + buffer);
  return [yStart, yEnd];
}

function lowerBound(ids: number[], target: number): number {
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ids[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function rangeIntersectsWanted(startId: number, endId: number, wanted: number[]): boolean {
  if (startId >= endId || wanted.length === 0) return false;
  const idx = lowerBound(wanted, startId);
  return idx < wanted.length && wanted[idx] < endId;
}

export function collectWantedTileIds(bbox: BoundingBox, minZoom: number, maxZoom: number): number[] {
  const ids: number[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    if (z <= 4) {
      const maxTile = (1 << z) - 1;
      for (let x = 0; x <= maxTile; x++) {
        for (let y = 0; y <= maxTile; y++) {
          ids.push(zxyToTileId(z, x, y));
        }
      }
    } else {
      const buffer = z >= 5 && z <= 8 ? 2 : z === 9 ? 1 : 0;
      const [yStart, yEnd] = getYRange(bbox.north, bbox.south, z, buffer);
      const xRanges = getXRanges(bbox.west, bbox.east, z, buffer);
      for (const [xStart, xEnd] of xRanges) {
        for (let x = xStart; x <= xEnd; x++) {
          for (let y = yStart; y <= yEnd; y++) {
            ids.push(zxyToTileId(z, x, y));
          }
        }
      }
    }
  }
  ids.sort((a, b) => a - b);
  return ids;
}

export function relevantEntries(
  wanted: number[],
  maxZoom: number,
  dir: Entry[]
): { tiles: Entry[]; leaves: Entry[] } {
  const lastTile = zxyToTileId(maxZoom + 1, 0, 0);
  const tiles: Entry[] = [];
  const leaves: Entry[] = [];

  for (let idx = 0; idx < dir.length; idx++) {
    const entry = dir[idx];
    const rangeEnd = idx === dir.length - 1 ? lastTile : dir[idx + 1].tileId;

    if (entry.runLength === 0) {
      if (rangeIntersectsWanted(entry.tileId, rangeEnd, wanted)) {
        leaves.push(entry);
      }
      continue;
    }

    const runEnd = entry.tileId + entry.runLength;
    let cursor = lowerBound(wanted, entry.tileId);
    while (cursor < wanted.length && wanted[cursor] < runEnd) {
      const startId = wanted[cursor];
      let run = 1;
      cursor++;
      while (cursor < wanted.length && wanted[cursor] < runEnd && wanted[cursor] === startId + run) {
        run++;
        cursor++;
      }
      tiles.push({
        tileId: startId,
        offset: entry.offset,
        length: entry.length,
        runLength: run,
      });
    }
  }

  return { tiles, leaves };
}

export function reencodeEntries(dir: Entry[]): {
  reencoded: Entry[];
  ranges: SrcDstRange[];
  tileDataLength: number;
  addressedTiles: number;
  tileContents: number;
} {
  const reencoded: Entry[] = [];
  const seenOffsets = new Map<number, number>();
  const ranges: SrcDstRange[] = [];
  let addressedTiles = 0;
  let dstOffset = 0;

  for (const entry of dir) {
    const existing = seenOffsets.get(entry.offset);
    if (existing !== undefined) {
      reencoded.push({
        tileId: entry.tileId,
        offset: existing,
        length: entry.length,
        runLength: entry.runLength,
      });
    } else {
      const lastRange = ranges[ranges.length - 1];
      if (lastRange && lastRange.srcOffset + lastRange.length === entry.offset) {
        lastRange.length += entry.length;
      } else {
        ranges.push({ srcOffset: entry.offset, dstOffset, length: entry.length });
      }
      reencoded.push({
        tileId: entry.tileId,
        offset: dstOffset,
        length: entry.length,
        runLength: entry.runLength,
      });
      seenOffsets.set(entry.offset, dstOffset);
      dstOffset += entry.length;
    }
    addressedTiles += entry.runLength;
  }

  return {
    reencoded,
    ranges,
    tileDataLength: dstOffset,
    addressedTiles,
    tileContents: seenOffsets.size,
  };
}

async function collectSourceEntries(
  pmt: PMTiles,
  header: Header,
  wanted: number[],
  maxZoom: number
): Promise<Entry[]> {
  const root = await pmt.cache.getDirectory(
    pmt.source,
    header.rootDirectoryOffset,
    header.rootDirectoryLength,
    header
  );
  const { tiles, leaves } = relevantEntries(wanted, maxZoom, root);

  for (const leaf of leaves) {
    const leafDir = await pmt.cache.getDirectory(
      pmt.source,
      header.leafDirectoryOffset + leaf.offset,
      leaf.length,
      header
    );
    const nested = relevantEntries(wanted, maxZoom, leafDir);
    if (nested.leaves.length > 0) {
      throw new Error('PMTiles extract does not support leaf directories deeper than 1');
    }
    tiles.push(...nested.tiles);
  }

  tiles.sort((a, b) => a.tileId - b.tileId);
  return tiles;
}

export async function planExtract(
  pmt: PMTiles,
  bbox: BoundingBox,
  minZoom: number,
  maxZoom: number
): Promise<ExtractPlan> {
  const header = await pmt.getHeader();
  const startZoom = Math.max(header.minZoom, minZoom);
  const endZoom = Math.min(header.maxZoom, maxZoom);
  if (startZoom > endZoom) {
    throw new Error('minZoom cannot be greater than maxZoom');
  }

  const wanted = collectWantedTileIds(bbox, startZoom, endZoom);
  const sourceEntries = await collectSourceEntries(pmt, header, wanted, endZoom);
  const { reencoded, ranges, tileDataLength, addressedTiles, tileContents } = reencodeEntries(sourceEntries);
  const { rootBytes, leavesBytes } = buildDirectories(
    reencoded,
    ROOT_TARGET_BYTES,
    header.internalCompression
  );

  const metadataResp = await pmt.source.getBytes(header.jsonMetadataOffset, header.jsonMetadataLength);
  const metadataBytes = Buffer.from(new Uint8Array(metadataResp.data));

  const rootDirectoryOffset = HEADER_SIZE_BYTES;
  const jsonMetadataOffset = rootDirectoryOffset + rootBytes.length;
  const leafDirectoryOffset = jsonMetadataOffset + metadataBytes.length;
  const tileDataOffset = leafDirectoryOffset + leavesBytes.length;

  const archiveHeader: ArchiveHeader = {
    rootDirectoryOffset,
    rootDirectoryLength: rootBytes.length,
    jsonMetadataOffset,
    jsonMetadataLength: metadataBytes.length,
    leafDirectoryOffset,
    leafDirectoryLength: leavesBytes.length,
    tileDataOffset,
    tileDataLength,
    numAddressedTiles: addressedTiles,
    numTileEntries: reencoded.length,
    numTileContents: tileContents,
    clustered: true,
    internalCompression: header.internalCompression,
    tileCompression: header.tileCompression,
    tileType: header.tileType,
    minZoom: startZoom,
    maxZoom: endZoom,
    minLon: bbox.west,
    minLat: bbox.south,
    maxLon: bbox.east,
    maxLat: bbox.north,
    centerZoom: Math.min(Math.max(header.centerZoom, startZoom), endZoom),
    centerLon: bbox.west <= bbox.east ? (bbox.west + bbox.east) / 2 : ((bbox.west + bbox.east + 360) / 2) % 360 - 180,
    centerLat: (bbox.south + bbox.north) / 2,
  };

  const headerBytes = serializeHeader(archiveHeader);
  const totalBytes = tileDataOffset + tileDataLength;

  return {
    headerBytes,
    rootBytes,
    metadataBytes,
    leavesBytes,
    ranges,
    sourceTileDataOffset: header.tileDataOffset,
    addressedTiles,
    totalBytes,
  };
}

export async function buildExtractBuffer(
  pmt: PMTiles,
  filePath: string,
  bbox: BoundingBox,
  minZoom: number,
  maxZoom: number
): Promise<Buffer> {
  const plan = await planExtract(pmt, bbox, minZoom, maxZoom);
  const parts: Buffer[] = [plan.headerBytes, plan.rootBytes, plan.metadataBytes, plan.leavesBytes];
  const fd = fs.openSync(filePath, 'r');
  try {
    for (const range of plan.ranges) {
      const buf = Buffer.allocUnsafe(range.length);
      fs.readSync(fd, buf, 0, range.length, plan.sourceTileDataOffset + range.srcOffset);
      parts.push(buf);
    }
  } finally {
    fs.closeSync(fd);
  }
  return Buffer.concat(parts);
}

const COPY_CHUNK = 1024 * 1024;

export async function streamPlannedExtract(
  filePath: string,
  plan: ExtractPlan,
  write: (chunk: Buffer) => Promise<void>,
  isAborted: () => boolean
): Promise<void> {
  await write(plan.headerBytes);
  if (isAborted()) return;
  await write(plan.rootBytes);
  if (isAborted()) return;
  await write(plan.metadataBytes);
  if (isAborted()) return;
  if (plan.leavesBytes.length > 0) {
    await write(plan.leavesBytes);
    if (isAborted()) return;
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    for (const range of plan.ranges) {
      let remaining = range.length;
      let srcPos = plan.sourceTileDataOffset + range.srcOffset;
      while (remaining > 0) {
        if (isAborted()) return;
        const n = Math.min(COPY_CHUNK, remaining);
        const buf = Buffer.allocUnsafe(n);
        fs.readSync(fd, buf, 0, n, srcPos);
        await write(buf);
        srcPos += n;
        remaining -= n;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

export async function streamExtract(
  pmt: PMTiles,
  filePath: string,
  bbox: BoundingBox,
  minZoom: number,
  maxZoom: number,
  write: (chunk: Buffer) => Promise<void>,
  isAborted: () => boolean
): Promise<ExtractPlan> {
  const plan = await planExtract(pmt, bbox, minZoom, maxZoom);
  await streamPlannedExtract(filePath, plan, write, isAborted);
  return plan;
}

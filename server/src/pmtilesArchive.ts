import { gzipSync } from 'zlib';
import { Compression, zxyToTileId, type Entry } from 'pmtiles';

export const HEADER_SIZE_BYTES = 127;
export const ROOT_TARGET_BYTES = 16384 - HEADER_SIZE_BYTES;

export interface ArchiveHeader {
  rootDirectoryOffset: number;
  rootDirectoryLength: number;
  jsonMetadataOffset: number;
  jsonMetadataLength: number;
  leafDirectoryOffset: number;
  leafDirectoryLength: number;
  tileDataOffset: number;
  tileDataLength: number;
  numAddressedTiles: number;
  numTileEntries: number;
  numTileContents: number;
  clustered: boolean;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  centerZoom: number;
  centerLon: number;
  centerLat: number;
}

class BufferWriter {
  public buffer: Buffer;
  public offset: number;

  constructor(initialCapacity = 65536) {
    this.buffer = Buffer.allocUnsafe(initialCapacity);
    this.offset = 0;
  }

  ensureCapacity(extra: number) {
    const required = this.offset + extra;
    if (required > this.buffer.length) {
      let newCapacity = Math.max(required, this.buffer.length * 2);
      const next = Buffer.allocUnsafe(newCapacity);
      this.buffer.copy(next, 0, 0, this.offset);
      this.buffer = next;
    }
  }

  writeVarint(value: number) {
    let v = value;
    if (!Number.isFinite(v) || v < 0) v = 0;
    this.ensureCapacity(10);
    while (v >= 0x80) {
      this.buffer[this.offset++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.buffer[this.offset++] = v;
  }

  toBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }
}

export function writeVarint(value: number, out: number[]): void {
  let v = value;
  if (!Number.isFinite(v) || v < 0) v = 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function setUint64LE(view: DataView, offset: number, value: number): void {
  const low = value % 0x100000000;
  const high = Math.floor(value / 0x100000000);
  view.setUint32(offset, low, true);
  view.setUint32(offset + 4, high, true);
}

export function serializeHeader(header: ArchiveHeader): Buffer {
  const bytes = Buffer.alloc(HEADER_SIZE_BYTES);
  bytes.write('PMTiles', 0, 7, 'ascii');
  bytes[7] = 3;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  setUint64LE(view, 8, header.rootDirectoryOffset);
  setUint64LE(view, 16, header.rootDirectoryLength);
  setUint64LE(view, 24, header.jsonMetadataOffset);
  setUint64LE(view, 32, header.jsonMetadataLength);
  setUint64LE(view, 40, header.leafDirectoryOffset);
  setUint64LE(view, 48, header.leafDirectoryLength);
  setUint64LE(view, 56, header.tileDataOffset);
  setUint64LE(view, 64, header.tileDataLength);
  setUint64LE(view, 72, header.numAddressedTiles);
  setUint64LE(view, 80, header.numTileEntries);
  setUint64LE(view, 88, header.numTileContents);
  bytes[96] = header.clustered ? 1 : 0;
  bytes[97] = header.internalCompression;
  bytes[98] = header.tileCompression;
  bytes[99] = header.tileType;
  bytes[100] = header.minZoom;
  bytes[101] = header.maxZoom;
  view.setInt32(102, Math.round(header.minLon * 10000000), true);
  view.setInt32(106, Math.round(header.minLat * 10000000), true);
  view.setInt32(110, Math.round(header.maxLon * 10000000), true);
  view.setInt32(114, Math.round(header.maxLat * 10000000), true);
  bytes[118] = header.centerZoom;
  view.setInt32(119, Math.round(header.centerLon * 10000000), true);
  view.setInt32(123, Math.round(header.centerLat * 10000000), true);
  return bytes;
}

export function serializeEntries(entries: Entry[], compression: number): Buffer {
  const estimatedSize = Math.max(64, entries.length * 6);
  const writer = new BufferWriter(estimatedSize);
  writer.writeVarint(entries.length);

  let lastId = 0;
  for (const entry of entries) {
    writer.writeVarint(entry.tileId - lastId);
    lastId = entry.tileId;
  }
  for (const entry of entries) {
    writer.writeVarint(entry.runLength);
  }
  for (const entry of entries) {
    writer.writeVarint(entry.length);
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (i > 0 && entry.offset === entries[i - 1].offset + entries[i - 1].length) {
      writer.writeVarint(0);
    } else {
      writer.writeVarint(entry.offset + 1);
    }
  }

  const uncompressed = writer.toBuffer();
  if (compression === Compression.None || compression === Compression.Unknown) {
    return uncompressed;
  }
  if (compression === Compression.Gzip) {
    return gzipSync(uncompressed);
  }
  throw new Error(`Unsupported directory compression: ${compression}`);
}

function buildRootsLeaves(entries: Entry[], leafSize: number, compression: number): {
  rootBytes: Buffer;
  leavesBytes: Buffer;
  numLeaves: number;
} {
  const rootEntries: Entry[] = [];
  const leafChunks: Buffer[] = [];
  let leavesLength = 0;
  let numLeaves = 0;

  for (let idx = 0; idx < entries.length; idx += leafSize) {
    numLeaves++;
    const end = Math.min(idx + leafSize, entries.length);
    const serialized = serializeEntries(entries.slice(idx, end), compression);
    rootEntries.push({
      tileId: entries[idx].tileId,
      offset: leavesLength,
      length: serialized.length,
      runLength: 0,
    });
    leafChunks.push(serialized);
    leavesLength += serialized.length;
  }

  return {
    rootBytes: serializeEntries(rootEntries, compression),
    leavesBytes: leafChunks.length === 1 ? leafChunks[0] : Buffer.concat(leafChunks),
    numLeaves,
  };
}

export function buildDirectories(
  entries: Entry[],
  targetRootLen: number,
  compression: number
): { rootBytes: Buffer; leavesBytes: Buffer; numLeaves: number } {
  if (entries.length === 0) {
    return { rootBytes: serializeEntries([], compression), leavesBytes: Buffer.alloc(0), numLeaves: 0 };
  }

  if (entries.length < 16384) {
    const testRootBytes = serializeEntries(entries, compression);
    if (testRootBytes.length <= targetRootLen) {
      return { rootBytes: testRootBytes, leavesBytes: Buffer.alloc(0), numLeaves: 0 };
    }
  }

  let leafSize = entries.length / 3500;
  if (leafSize < 4096) leafSize = 4096;

  for (;;) {
    const built = buildRootsLeaves(entries, Math.floor(leafSize), compression);
    if (built.rootBytes.length <= targetRootLen) {
      return built;
    }
    leafSize *= 1.2;
  }
}

export interface BuiltTile {
  z: number;
  x: number;
  y: number;
  data: Uint8Array;
}

export function buildPmtilesBuffer(options: {
  tiles: BuiltTile[];
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  tileCompression?: number;
  internalCompression?: number;
  tileType?: number;
  metadata?: unknown;
}): Buffer {
  const internalCompression = options.internalCompression ?? Compression.Gzip;
  const tileCompression = options.tileCompression ?? Compression.None;

  const sorted = options.tiles
    .map((tile) => ({ ...tile, tileId: zxyToTileId(tile.z, tile.x, tile.y) }))
    .sort((a, b) => a.tileId - b.tileId);

  const entries: Entry[] = [];
  const bodies: Buffer[] = [];
  let dstOffset = 0;
  const seen = new Map<string, number>();

  for (const tile of sorted) {
    const key = Buffer.from(tile.data).toString('hex');
    const existing = seen.get(key);
    if (existing !== undefined) {
      entries.push({
        tileId: tile.tileId,
        offset: existing,
        length: tile.data.byteLength,
        runLength: 1,
      });
      continue;
    }
    seen.set(key, dstOffset);
    entries.push({
      tileId: tile.tileId,
      offset: dstOffset,
      length: tile.data.byteLength,
      runLength: 1,
    });
    bodies.push(Buffer.from(tile.data));
    dstOffset += tile.data.byteLength;
  }

  const { rootBytes, leavesBytes } = buildDirectories(entries, ROOT_TARGET_BYTES, internalCompression);
  const metadataJson = Buffer.from(JSON.stringify(options.metadata ?? { name: 'extract' }), 'utf8');
  const metadataBytes = internalCompression === Compression.Gzip ? gzipSync(metadataJson) : metadataJson;

  const rootDirectoryOffset = HEADER_SIZE_BYTES;
  const jsonMetadataOffset = rootDirectoryOffset + rootBytes.length;
  const leafDirectoryOffset = jsonMetadataOffset + metadataBytes.length;
  const tileDataOffset = leafDirectoryOffset + leavesBytes.length;
  const tileData = bodies.length ? Buffer.concat(bodies) : Buffer.alloc(0);

  const header = serializeHeader({
    rootDirectoryOffset,
    rootDirectoryLength: rootBytes.length,
    jsonMetadataOffset,
    jsonMetadataLength: metadataBytes.length,
    leafDirectoryOffset,
    leafDirectoryLength: leavesBytes.length,
    tileDataOffset,
    tileDataLength: tileData.length,
    numAddressedTiles: entries.reduce((sum, e) => sum + e.runLength, 0),
    numTileEntries: entries.length,
    numTileContents: seen.size,
    clustered: true,
    internalCompression,
    tileCompression,
    tileType: options.tileType ?? 1,
    minZoom: options.minZoom,
    maxZoom: options.maxZoom,
    minLon: options.minLon,
    minLat: options.minLat,
    maxLon: options.maxLon,
    maxLat: options.maxLat,
    centerZoom: options.minZoom,
    centerLon: (options.minLon + options.maxLon) / 2,
    centerLat: (options.minLat + options.maxLat) / 2,
  });

  return Buffer.concat([header, rootBytes, metadataBytes, leavesBytes, tileData]);
}

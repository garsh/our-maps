import { describe, it, expect } from 'vitest';
import { Compression, PMTiles, zxyToTileId } from 'pmtiles';
import {
  HEADER_SIZE_BYTES,
  buildDirectories,
  buildPmtilesBuffer,
  serializeEntries,
  serializeHeader,
} from '../pmtilesArchive';

class BufferSource {
  constructor(private buffer: Buffer, private key = 'fixture.pmtiles') {}
  getKey() { return this.key; }
  async getBytes(offset: number, length: number) {
    const slice = this.buffer.subarray(offset, offset + length);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer };
  }
}

describe('pmtilesArchive', () => {
  it('round-trips a header through serializeHeader', () => {
    const bytes = serializeHeader({
      rootDirectoryOffset: 127,
      rootDirectoryLength: 40,
      jsonMetadataOffset: 167,
      jsonMetadataLength: 20,
      leafDirectoryOffset: 187,
      leafDirectoryLength: 0,
      tileDataOffset: 187,
      tileDataLength: 50,
      numAddressedTiles: 3,
      numTileEntries: 3,
      numTileContents: 2,
      clustered: true,
      internalCompression: Compression.Gzip,
      tileCompression: Compression.Gzip,
      tileType: 1,
      minZoom: 1,
      maxZoom: 15,
      minLon: -74.1,
      minLat: 40.6,
      maxLon: -73.9,
      maxLat: 40.8,
      centerZoom: 10,
      centerLon: -74,
      centerLat: 40.7,
    });

    expect(bytes.length).toBe(HEADER_SIZE_BYTES);
    expect(bytes.toString('ascii', 0, 7)).toBe('PMTiles');
    expect(bytes[7]).toBe(3);
    expect(bytes[96]).toBe(1);
  });

  it('serializes an empty directory that the PMTiles reader can open', async () => {
    const archive = buildPmtilesBuffer({
      tiles: [],
      minZoom: 1,
      maxZoom: 1,
      minLon: -10,
      minLat: -10,
      maxLon: 10,
      maxLat: 10,
      internalCompression: Compression.Gzip,
      tileCompression: Compression.None,
    });
    const pmt = new PMTiles(new BufferSource(archive));
    const header = await pmt.getHeader();
    expect(header.minZoom).toBe(1);
    expect(header.numAddressedTiles).toBe(0);
    expect(await pmt.getZxy(1, 0, 0)).toBeUndefined();
  });

  it('builds a clustered archive that getZxy can read without decompressing tile bytes', async () => {
    const tileA = new Uint8Array([1, 2, 3, 4]);
    const tileB = new Uint8Array([9, 9, 9]);
    const archive = buildPmtilesBuffer({
      tiles: [
        { z: 1, x: 0, y: 0, data: tileA },
        { z: 1, x: 1, y: 0, data: tileB },
        { z: 1, x: 0, y: 1, data: tileA },
      ],
      minZoom: 1,
      maxZoom: 1,
      minLon: -180,
      minLat: -85,
      maxLon: 180,
      maxLat: 85,
      internalCompression: Compression.None,
      tileCompression: Compression.None,
    });

    const pmt = new PMTiles(new BufferSource(archive));
    const a = await pmt.getZxy(1, 0, 0);
    const b = await pmt.getZxy(1, 1, 0);
    const a2 = await pmt.getZxy(1, 0, 1);
    expect(Array.from(new Uint8Array(a!.data))).toEqual([1, 2, 3, 4]);
    expect(Array.from(new Uint8Array(b!.data))).toEqual([9, 9, 9]);
    expect(Array.from(new Uint8Array(a2!.data))).toEqual([1, 2, 3, 4]);

    const header = await pmt.getHeader();
    expect(header.clustered).toBe(true);
    expect(header.numTileEntries).toBe(3);
    expect(header.numTileContents).toBe(2);
  });

  it('splits directories into leaves when the root would exceed the target length', () => {
    const entries = [];
    for (let i = 0; i < 20000; i++) {
      entries.push({ tileId: i * 10, offset: i * 8, length: 8, runLength: 1 });
    }
    const { rootBytes, leavesBytes, numLeaves } = buildDirectories(entries, 200, Compression.None);
    expect(numLeaves).toBeGreaterThan(0);
    expect(leavesBytes.length).toBeGreaterThan(0);
    expect(rootBytes.length).toBeLessThanOrEqual(200);

    const root = serializeEntries(
      [{ tileId: 0, offset: 0, length: 1, runLength: 0 }],
      Compression.None
    );
    expect(root.length).toBeGreaterThan(0);
  });

  it('writes gzip-compressed directories that the PMTiles reader can open', async () => {
    const archive = buildPmtilesBuffer({
      tiles: [{ z: 2, x: 1, y: 1, data: new Uint8Array([7, 8]) }],
      minZoom: 2,
      maxZoom: 2,
      minLon: 0,
      minLat: 0,
      maxLon: 10,
      maxLat: 10,
      internalCompression: Compression.Gzip,
      tileCompression: Compression.None,
    });
    const pmt = new PMTiles(new BufferSource(archive));
    const tile = await pmt.getZxy(2, 1, 1);
    expect(tile).toBeDefined();
    expect(Array.from(new Uint8Array(tile!.data))).toEqual([7, 8]);
    expect(zxyToTileId(2, 1, 1)).toBeGreaterThan(0);
  });
});

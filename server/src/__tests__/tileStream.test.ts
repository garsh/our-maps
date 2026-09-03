import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { Compression, PMTiles } from 'pmtiles';
import { handleTileStream } from '../tileStream';
import { buildPmtilesBuffer } from '../pmtilesArchive';
import { clearMapFilePathCache } from '../mapFiles';

describe('tileStream handler', () => {
  it('returns 400 if bbox is missing or invalid', async () => {
    let statusCode = 200;
    let jsonResult: any = null;
    const req: any = { body: {}, on: () => {} };
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => { jsonResult = data; }
        };
      }
    };

    await handleTileStream(req, res, []);
    expect(statusCode).toBe(400);
    expect(jsonResult.error).toContain('Valid bbox');
  });

  it('returns 404 if planet.pmtiles is not found', async () => {
    let statusCode = 200;
    let jsonResult: any = null;
    const req: any = {
      body: {
        bbox: { north: 10, south: 0, east: 10, west: 0 }
      },
      on: () => {}
    };
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => { jsonResult = data; }
        };
      }
    };

    await handleTileStream(req, res, ['/nonexistent/directory']);
    expect(statusCode).toBe(404);
    expect(jsonResult.error).toContain('planet.pmtiles');
  });

  it('streams a PMTiles extract with Content-Length and readable tiles', async () => {
    const tiles = [];
    for (let z = 1; z <= 2; z++) {
      const maxTile = (1 << z) - 1;
      for (let x = 0; x <= maxTile; x++) {
        for (let y = 0; y <= maxTile; y++) {
          tiles.push({ z, x, y, data: new Uint8Array([z, x, y, 99]) });
        }
      }
    }
    const archive = buildPmtilesBuffer({
      tiles,
      minZoom: 1,
      maxZoom: 2,
      minLon: -180,
      minLat: -85,
      maxLon: 180,
      maxLat: 85,
      internalCompression: Compression.None,
      tileCompression: Compression.None,
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tile-stream-'));
    fs.writeFileSync(path.join(dir, 'planet.pmtiles'), archive);
    clearMapFilePathCache();

    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    let ended = false;
    const req: any = {
      body: { bbox: { north: 10, south: -10, east: 10, west: -10 }, minZoom: 1, maxZoom: 2 },
      on: () => {}
    };
    const res: any = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      setHeader: (k: string, v: string) => { headers[k] = v; },
      write: (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
        return true;
      },
      end: () => { ended = true; res.writableEnded = true; },
      status: () => res,
      json: () => res,
      destroy: () => { res.destroyed = true; },
    };

    await handleTileStream(req, res, [dir]);
    const body = Buffer.concat(chunks);
    expect(ended).toBe(true);
    expect(headers['Content-Type']).toBe('application/vnd.pmtiles');
    expect(Number(headers['Content-Length'])).toBe(body.length);
    expect(Number(headers['X-Total-Tiles'])).toBeGreaterThan(0);
    expect(body.toString('ascii', 0, 7)).toBe('PMTiles');

    class BufferSource {
      constructor(private buffer: Buffer) {}
      getKey() { return 'out.pmtiles'; }
      async getBytes(offset: number, length: number) {
        const slice = this.buffer.subarray(offset, offset + length);
        return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer };
      }
    }
    const pmt = new PMTiles(new BufferSource(body));
    const tile = await pmt.getZxy(1, 0, 0);
    expect(tile).toBeDefined();
    expect(Array.from(new Uint8Array(tile!.data))).toEqual([1, 0, 0, 99]);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Compression, PMTiles } from 'pmtiles';
import { handleExtractSize, handleTileStream, parseExtractResumeOffset, computeBboxFromPins } from '../tileStream';
import { buildPmtilesBuffer } from '../pmtilesArchive';
import { clearMapFilePathCache } from '../mapFiles';
import { BufferSource } from './testHelpers';

describe('tileStream handler', () => {
  let sharedDir: string;

  beforeAll(() => {
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
    sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tile-stream-shared-'));
    fs.writeFileSync(path.join(sharedDir, 'planet.pmtiles'), archive);
    clearMapFilePathCache();
  });

  afterAll(() => {
    if (sharedDir && fs.existsSync(sharedDir)) {
      fs.rmSync(sharedDir, { recursive: true, force: true });
    }
  });
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

    await handleTileStream(req, res, [sharedDir]);
    const body = Buffer.concat(chunks);
    expect(ended).toBe(true);
    expect(headers['Content-Type']).toBe('application/vnd.pmtiles');
    expect(Number(headers['Content-Length'])).toBe(body.length);
    expect(Number(headers['X-Total-Tiles'])).toBeGreaterThan(0);
    expect(body.toString('ascii', 0, 7)).toBe('PMTiles');

    const pmt = new PMTiles(new BufferSource(body, 'out.pmtiles'));
    const tile = await pmt.getZxy(1, 0, 0);
    expect(tile).toBeDefined();
    expect(Array.from(new Uint8Array(tile!.data))).toEqual([1, 0, 0, 99]);
  });

  it('reports extract size matching the streamed archive', async () => {
    let jsonResult: any = null;
    const req: any = {
      body: { bbox: { north: 10, south: -10, east: 10, west: -10 }, minZoom: 1, maxZoom: 2 },
    };
    const res: any = {
      status: (code: number) => {
        res.statusCode = code;
        return res;
      },
      json: (data: any) => { jsonResult = data; return res; },
    };

    await handleExtractSize(req, res, [sharedDir]);
    expect(jsonResult.bytes).toBeGreaterThan(0);
    expect(jsonResult.addressedTiles).toBeGreaterThan(0);

    const chunks: Buffer[] = [];
    const streamReq: any = { body: req.body, on: () => {} };
    const streamRes: any = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      setHeader: () => {},
      write: (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); return true; },
      end: () => { streamRes.writableEnded = true; },
      status: () => streamRes,
      json: () => streamRes,
      destroy: () => { streamRes.destroyed = true; },
    };
    await handleTileStream(streamReq, streamRes, [sharedDir]);
    expect(jsonResult.bytes).toBe(Buffer.concat(chunks).length);
  });

  it('parses resume offsets from query, JSON body, or Range header', () => {
    expect(parseExtractResumeOffset({ query: {}, body: {}, headers: {} } as any)).toBe(0);
    expect(parseExtractResumeOffset({ query: { offset: '1024' }, body: {}, headers: {} } as any)).toBe(1024);
    expect(parseExtractResumeOffset({ query: { offset: 2048 }, body: {}, headers: {} } as any)).toBe(2048);
    expect(parseExtractResumeOffset({ query: {}, body: { offset: 4096 }, headers: {} } as any)).toBe(4096);
    expect(parseExtractResumeOffset({ query: {}, body: {}, headers: { range: 'bytes=2048-' } } as any)).toBe(2048);
    expect(parseExtractResumeOffset({ query: { offset: 50 }, body: { offset: 10 }, headers: { range: 'bytes=99-' } } as any)).toBe(50);
    expect(parseExtractResumeOffset({ query: {}, body: { offset: 10 }, headers: { range: 'bytes=99-' } } as any)).toBe(10);
    expect(parseExtractResumeOffset({ query: { offset: '-5' }, body: { offset: -5 }, headers: { range: 'bytes=0-' } } as any)).toBe(0);
  });

  it('returns 206 and remaining bytes when resuming from an offset', async () => {
    const fullChunks: Buffer[] = [];
    const fullHeaders: Record<string, string> = {};
    const fullReq: any = {
      body: { bbox: { north: 10, south: -10, east: 10, west: -10 }, minZoom: 1, maxZoom: 2 },
      on: () => {}
    };
    const fullRes: any = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      setHeader: (k: string, v: string) => { fullHeaders[k] = v; },
      write: (chunk: Buffer) => { fullChunks.push(Buffer.from(chunk)); return true; },
      end: () => { fullRes.writableEnded = true; },
      status: () => fullRes,
      json: () => fullRes,
      destroy: () => { fullRes.destroyed = true; },
    };
    await handleTileStream(fullReq, fullRes, [sharedDir]);
    const full = Buffer.concat(fullChunks);
    const offset = Math.floor(full.length / 2);

    const resumeChunks: Buffer[] = [];
    const resumeHeaders: Record<string, string> = {};
    let statusCode = 200;
    const resumeReq: any = {
      body: {
        bbox: { north: 10, south: -10, east: 10, west: -10 },
        minZoom: 1,
        maxZoom: 2,
        offset,
      },
      headers: { range: `bytes=${offset}-` },
      on: () => {}
    };
    const resumeRes: any = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      setHeader: (k: string, v: string) => { resumeHeaders[k] = v; },
      write: (chunk: Buffer) => { resumeChunks.push(Buffer.from(chunk)); return true; },
      end: () => { resumeRes.writableEnded = true; },
      status: (code: number) => { statusCode = code; return resumeRes; },
      json: () => resumeRes,
      destroy: () => { resumeRes.destroyed = true; },
    };
    await handleTileStream(resumeReq, resumeRes, [sharedDir]);
    const rest = Buffer.concat(resumeChunks);
    expect(statusCode).toBe(206);
    expect(Number(resumeHeaders['X-Extract-Offset'])).toBe(offset);
    expect(Number(resumeHeaders['X-Extract-Bytes'])).toBe(full.length);
    expect(Number(resumeHeaders['Content-Length'])).toBe(full.length - offset);
    expect(resumeHeaders['Content-Range']).toBe(`bytes ${offset}-${full.length - 1}/${full.length}`);
    expect(rest.equals(full.subarray(offset))).toBe(true);

    const tooFarReq: any = {
      body: { ...resumeReq.body, offset: full.length },
      headers: { range: `bytes=${full.length}-` },
      on: () => {}
    };
    let goneStatus = 200;
    let goneJson: any = null;
    const tooFarRes: any = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      setHeader: () => {},
      write: () => true,
      end: () => { tooFarRes.writableEnded = true; },
      status: (code: number) => { goneStatus = code; return tooFarRes; },
      json: (data: any) => { goneJson = data; return tooFarRes; },
      destroy: () => { tooFarRes.destroyed = true; },
    };
    await handleTileStream(tooFarReq, tooFarRes, [sharedDir]);
    expect(goneStatus).toBe(416);
    expect(goneJson.bytes).toBe(full.length);
  });

  describe('computeBboxFromPins', () => {
    it('returns null for empty pins array', () => {
      expect(computeBboxFromPins([])).toBeNull();
      expect(computeBboxFromPins(null as any)).toBeNull();
    });

    it('returns padded bounding box for a single pin', () => {
      const bbox = computeBboxFromPins([{ lat: 40.0, lng: -74.0 }]);
      expect(bbox).not.toBeNull();
      expect(bbox!.north).toBeCloseTo(40.05);
      expect(bbox!.south).toBeCloseTo(39.95);
      expect(bbox!.east).toBeCloseTo(-73.95);
      expect(bbox!.west).toBeCloseTo(-74.05);
    });

    it('returns padded bounding box covering multiple pins', () => {
      const bbox = computeBboxFromPins([
        { lat: 10.0, lng: 20.0 },
        { lat: 15.0, lng: 30.0 },
      ]);
      expect(bbox).not.toBeNull();
      expect(bbox!.north).toBeGreaterThan(15.0);
      expect(bbox!.south).toBeLessThan(10.0);
      expect(bbox!.east).toBeGreaterThan(30.0);
      expect(bbox!.west).toBeLessThan(20.0);
    });
  });

  describe('GET request extract handling', () => {
    it('handles GET request with bounding box query parameters', async () => {
      const chunks: Buffer[] = [];
      const headers: Record<string, string> = {};
      let ended = false;
      const req: any = {
        method: 'GET',
        params: { id: 'map-abc' },
        query: { north: '10', south: '-10', east: '10', west: '-10', minZoom: '1', maxZoom: '2' },
        headers: {},
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

      await handleTileStream(req, res, [sharedDir]);
      const body = Buffer.concat(chunks);
      expect(ended).toBe(true);
      expect(headers['Content-Type']).toBe('application/vnd.pmtiles');
      expect(headers['Content-Disposition']).toBe('attachment; filename="map-abc.pmtiles"');
      expect(headers['Accept-Ranges']).toBe('bytes');
      expect(Number(headers['X-Total-Tiles'])).toBeGreaterThan(0);
      expect(Number(headers['X-Extract-Bytes'])).toBe(body.length);
      expect(body.toString('ascii', 0, 7)).toBe('PMTiles');
    });

    it('handles GET request with derived bounding box', async () => {
      const chunks: Buffer[] = [];
      const headers: Record<string, string> = {};
      let ended = false;
      const req: any = {
        method: 'GET',
        params: { id: 'my-pins-map' },
        query: { minZoom: '1', maxZoom: '2' },
        derivedBbox: { north: 10, south: -10, east: 10, west: -10 },
        headers: {},
        on: () => {}
      };
      const res: any = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        setHeader: (k: string, v: string) => { headers[k] = v; },
        write: (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); return true; },
        end: () => { ended = true; res.writableEnded = true; },
        status: () => res,
        json: () => res,
        destroy: () => { res.destroyed = true; },
      };

      await handleTileStream(req, res, [sharedDir]);
      expect(ended).toBe(true);
      expect(headers['Content-Disposition']).toBe('attachment; filename="my-pins-map.pmtiles"');
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('returns 206 Partial Content on GET with Range header', async () => {
      const fullChunks: Buffer[] = [];
      const fullReq: any = {
        method: 'GET',
        params: { id: 'range-map' },
        query: { north: '10', south: '-10', east: '10', west: '-10', minZoom: '1', maxZoom: '2' },
        headers: {},
        on: () => {}
      };
      const fullRes: any = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        setHeader: () => {},
        write: (chunk: Buffer) => { fullChunks.push(Buffer.from(chunk)); return true; },
        end: () => { fullRes.writableEnded = true; },
        status: () => fullRes,
        json: () => fullRes,
        destroy: () => {},
      };
      await handleTileStream(fullReq, fullRes, [sharedDir]);
      const fullBody = Buffer.concat(fullChunks);
      const offset = 100;

      const resumeChunks: Buffer[] = [];
      const resumeHeaders: Record<string, string> = {};
      let statusCode = 200;
      const resumeReq: any = {
        method: 'GET',
        params: { id: 'range-map' },
        query: { north: '10', south: '-10', east: '10', west: '-10', minZoom: '1', maxZoom: '2' },
        headers: { range: `bytes=${offset}-` },
        on: () => {}
      };
      const resumeRes: any = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        setHeader: (k: string, v: string) => { resumeHeaders[k] = v; },
        write: (chunk: Buffer) => { resumeChunks.push(Buffer.from(chunk)); return true; },
        end: () => { resumeRes.writableEnded = true; },
        status: (code: number) => { statusCode = code; return resumeRes; },
        json: () => resumeRes,
        destroy: () => {},
      };

      await handleTileStream(resumeReq, resumeRes, [sharedDir]);
      expect(statusCode).toBe(206);
      expect(resumeHeaders['Content-Range']).toBe(`bytes ${offset}-${fullBody.length - 1}/${fullBody.length}`);
      expect(Number(resumeHeaders['Content-Length'])).toBe(fullBody.length - offset);
      const partialBody = Buffer.concat(resumeChunks);
      expect(partialBody.equals(fullBody.subarray(offset))).toBe(true);
    });

    it('returns 206 Partial Content on GET with query offset', async () => {
      const fullChunks: Buffer[] = [];
      const fullReq: any = {
        method: 'GET',
        params: { id: 'query-offset-map' },
        query: { north: '10', south: '-10', east: '10', west: '-10', minZoom: '1', maxZoom: '2' },
        headers: {},
        on: () => {}
      };
      const fullRes: any = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        setHeader: () => {},
        write: (chunk: Buffer) => { fullChunks.push(Buffer.from(chunk)); return true; },
        end: () => { fullRes.writableEnded = true; },
        status: () => fullRes,
        json: () => fullRes,
        destroy: () => {},
      };
      await handleTileStream(fullReq, fullRes, [sharedDir]);
      const fullBody = Buffer.concat(fullChunks);
      const offset = 120;

      const resumeChunks: Buffer[] = [];
      const resumeHeaders: Record<string, string> = {};
      let statusCode = 200;
      const resumeReq: any = {
        method: 'GET',
        params: { id: 'query-offset-map' },
        query: { north: '10', south: '-10', east: '10', west: '-10', minZoom: '1', maxZoom: '2', offset: String(offset) },
        headers: {},
        on: () => {}
      };
      const resumeRes: any = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        setHeader: (k: string, v: string) => { resumeHeaders[k] = v; },
        write: (chunk: Buffer) => { resumeChunks.push(Buffer.from(chunk)); return true; },
        end: () => { resumeRes.writableEnded = true; },
        status: (code: number) => { statusCode = code; return resumeRes; },
        json: () => resumeRes,
        destroy: () => {},
      };

      await handleTileStream(resumeReq, resumeRes, [sharedDir]);
      expect(statusCode).toBe(206);
      expect(resumeHeaders['Content-Range']).toBe(`bytes ${offset}-${fullBody.length - 1}/${fullBody.length}`);
      expect(Number(resumeHeaders['Content-Length'])).toBe(fullBody.length - offset);
      const partialBody = Buffer.concat(resumeChunks);
      expect(partialBody.equals(fullBody.subarray(offset))).toBe(true);
    });
  });
});

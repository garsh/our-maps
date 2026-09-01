import { describe, it, expect } from 'vitest';
import { handleTileStream } from '../tileStream';

describe('tileStream handler', () => {
  it('returns 400 if bbox is missing or invalid', async () => {
    let statusCode = 200;
    let jsonResult: any = null;
    const req: any = { body: {} };
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
      }
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
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  sanitizeMapFilename,
  resolveSafeMapFile,
  getSafeFontDownloadTarget,
  isPathInside,
  clearMapFilePathCache,
  getSafeMapFileSize,
  ensureOnDemandFontFile,
  clearFontDownloadInflightForTests,
  buildCandidateMapsDirs,
  evaluateFileRange,
  PMTILES_MAX_RANGE_BYTES
} from '../mapFiles';

describe('candidate map directories', () => {
  it('does not use filesystem root or /data as a search root', () => {
    const dirs = buildCandidateMapsDirs({
      cwd: '/app',
      extraRoots: ['/', '/app'],
      mapsDir: undefined,
    });
    expect(dirs).not.toContain('/data');
    expect(dirs).not.toContain('/');
    expect(dirs).toContain(path.resolve('/app', 'data/maps'));
    expect(dirs.some((d) => d === path.resolve('/', 'data/maps') || d === '/data/maps')).toBe(false);
  });
});

describe('PMTiles range limits', () => {
  const total = 137_000_000_000;

  it('requires a Range header and caps length at 8 MiB', () => {
    expect(evaluateFileRange(undefined, total, { requireRange: true, maxBytes: PMTILES_MAX_RANGE_BYTES })).toEqual({
      ok: false,
      status: 400,
      error: 'Range header required',
    });
    expect(evaluateFileRange('bytes=0-', total, { requireRange: true, maxBytes: PMTILES_MAX_RANGE_BYTES })).toEqual({
      ok: false,
      status: 416,
      error: 'Range too large',
    });
    expect(evaluateFileRange('bytes=0-16383', total, { requireRange: true, maxBytes: PMTILES_MAX_RANGE_BYTES })).toEqual({
      ok: true,
      start: 0,
      end: 16383,
    });
  });

  it('still allows full-file GET when Range is not required', () => {
    expect(evaluateFileRange(undefined, 100)).toEqual({ ok: true, start: 0, end: 99 });
  });
});

describe('map file path sanitization', () => {
  it('accepts normal map, sprite, and font paths', () => {
    expect(sanitizeMapFilename('planet.pmtiles')).toBe('planet.pmtiles');
    expect(sanitizeMapFilename('sprites/light@2x.png')).toBe('sprites/light@2x.png');
    expect(sanitizeMapFilename('fonts/Noto Sans Regular/0-255.pbf')).toBe('fonts/Noto Sans Regular/0-255.pbf');
  });

  it('rejects parent-directory traversal', () => {
    expect(sanitizeMapFilename('../database.sqlite')).toBeNull();
    expect(sanitizeMapFilename('fonts/../../../etc/passwd')).toBeNull();
    expect(sanitizeMapFilename('sprites/../../server/src/index.ts')).toBeNull();
    expect(sanitizeMapFilename('..\\..\\etc\\passwd')).toBeNull();
  });

  it('rejects absolute paths, URLs, and disallowed extensions', () => {
    expect(sanitizeMapFilename('/etc/passwd')).toBeNull();
    expect(sanitizeMapFilename('https://evil.example/x.png')).toBeNull();
    expect(sanitizeMapFilename('database.sqlite')).toBeNull();
    expect(sanitizeMapFilename('secrets.env')).toBeNull();
  });
});

describe('safe map file resolution', () => {
  let tempRoot: string;
  let mapsDir: string;
  let spritesDir: string;
  let secretFile: string;

  beforeAll(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ourmaps-mapfiles-'));
    mapsDir = path.join(tempRoot, 'maps');
    spritesDir = path.join(tempRoot, 'sprites');
    secretFile = path.join(tempRoot, 'secret.json');
    fs.mkdirSync(mapsDir, { recursive: true });
    fs.mkdirSync(spritesDir, { recursive: true });
    fs.writeFileSync(path.join(spritesDir, 'light.png'), 'sprite');
    fs.writeFileSync(secretFile, '{"secret":true}');
  });

  beforeEach(() => {
    clearMapFilePathCache();
  });

  afterAll(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('resolves files inside allowlisted directories', () => {
    const resolved = resolveSafeMapFile('sprites/light.png', [spritesDir]);
    expect(resolved).toBe(path.resolve(spritesDir, 'light.png'));
  });

  it('does not resolve files outside allowlisted directories', () => {
    expect(resolveSafeMapFile('../secret.json', [mapsDir, spritesDir])).toBeNull();
    expect(resolveSafeMapFile('../../secret.json', [mapsDir])).toBeNull();
    expect(isPathInside(mapsDir, secretFile)).toBe(false);
  });

  it('does not follow a symlink out of the allowlisted directories', () => {
    const linkPath = path.join(mapsDir, 'escape.json');
    fs.symlinkSync(secretFile, linkPath);
    expect(resolveSafeMapFile('escape.json', [mapsDir, spritesDir])).toBeNull();
  });

  it('allows a symlink whose real path is still inside another allowlisted dir', () => {
    const linkPath = path.join(mapsDir, 'light.png');
    fs.symlinkSync(path.join(spritesDir, 'light.png'), linkPath);
    expect(resolveSafeMapFile('light.png', [mapsDir, spritesDir])).toBe(
      path.resolve(spritesDir, 'light.png')
    );
  });

  it('confines on-demand font downloads to the data root', () => {
    const dataRoot = path.join(tempRoot, 'data');
    const ok = getSafeFontDownloadTarget('fonts/Noto Sans Regular/0-255.pbf', dataRoot);
    expect(ok?.targetPath).toBe(path.resolve(dataRoot, 'fonts/Noto Sans Regular/0-255.pbf'));
    expect(isPathInside(dataRoot, ok!.targetPath)).toBe(true);

    expect(getSafeFontDownloadTarget('fonts/../../../tmp/evil.pbf', dataRoot)).toBeNull();
    expect(getSafeFontDownloadTarget('sprites/light.png', dataRoot)).toBeNull();
    expect(getSafeFontDownloadTarget('fonts/FakeFont/0-255.pbf', dataRoot)).toBeNull();
    expect(getSafeFontDownloadTarget('fonts/Noto Sans Regular/not-a-range.pbf', dataRoot)).toBeNull();

    // CJK / international range in allowed fontstack
    const cjk = getSafeFontDownloadTarget('fonts/Noto Sans Regular/19968-20223.pbf', dataRoot);
    expect(cjk?.targetPath).toBe(path.resolve(dataRoot, 'fonts/Noto Sans Regular/19968-20223.pbf'));
  });

  it('calculates and caches safe map file size asynchronously', async () => {
    const filePath = path.join(spritesDir, 'light.png');
    const size = await getSafeMapFileSize(filePath);
    expect(size).toBe(Buffer.byteLength('sprite'));

    // Returns cached size on subsequent calls
    const cachedSize = await getSafeMapFileSize(filePath);
    expect(cachedSize).toBe(size);
  });
});

describe('ensureOnDemandFontFile', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ourmaps-fonts-'));
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearFontDownloadInflightForTests();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('downloads a missing glyph range once and coalesces concurrent callers', async () => {
    const dataRoot = path.join(tempRoot, 'data-once');
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      } as Response;
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      ensureOnDemandFontFile('fonts/Noto Sans Regular/0-255.pbf', dataRoot),
      ensureOnDemandFontFile('fonts/Noto Sans Regular/0-255.pbf', dataRoot)
    ]);

    expect(fetchCount).toBe(1);
    expect(first).toBe(path.resolve(dataRoot, 'fonts/Noto Sans Regular/0-255.pbf'));
    expect(second).toBe(first);
    expect(fs.readFileSync(first!)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rejects font paths outside the data root', async () => {
    const dataRoot = path.join(tempRoot, 'data-evil');
    expect(await ensureOnDemandFontFile('fonts/../../../tmp/evil.pbf', dataRoot)).toBeNull();
  });
});

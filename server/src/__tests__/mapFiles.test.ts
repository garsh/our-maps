import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  sanitizeMapFilename,
  resolveSafeMapFile,
  getSafeFontDownloadTarget,
  isPathInside,
  clearMapFilePathCache,
  getSafeMapFileSize
} from '../mapFiles';

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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ourmaps-mapfiles-'));
  const mapsDir = path.join(tempRoot, 'maps');
  const spritesDir = path.join(tempRoot, 'sprites');
  const secretFile = path.join(tempRoot, 'secret.json');

  beforeEach(() => {
    clearMapFilePathCache();
    fs.mkdirSync(mapsDir, { recursive: true });
    fs.mkdirSync(spritesDir, { recursive: true });
    fs.writeFileSync(path.join(spritesDir, 'light.png'), 'sprite');
    fs.writeFileSync(secretFile, '{"secret":true}');
  });

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
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

  it('confines on-demand font downloads to the data root', () => {
    const dataRoot = path.join(tempRoot, 'data');
    const ok = getSafeFontDownloadTarget('fonts/Noto Sans Regular/0-255.pbf', dataRoot);
    expect(ok?.targetPath).toBe(path.resolve(dataRoot, 'fonts/Noto Sans Regular/0-255.pbf'));
    expect(isPathInside(dataRoot, ok!.targetPath)).toBe(true);

    expect(getSafeFontDownloadTarget('fonts/../../../tmp/evil.pbf', dataRoot)).toBeNull();
    expect(getSafeFontDownloadTarget('sprites/light.png', dataRoot)).toBeNull();
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

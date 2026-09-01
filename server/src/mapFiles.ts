import fs from 'fs';
import path from 'path';

export const ALLOWED_MAP_EXTENSIONS = new Set(['.pmtiles', '.pbf', '.png', '.json']);

const resolvedMapFilePathCache = new Map<string, string>();
const resolvedMapFileSizeCache = new Map<string, number>();

export async function getSafeMapFileSize(filePath: string): Promise<number> {
  const cached = resolvedMapFileSizeCache.get(filePath);
  if (cached !== undefined) return cached;
  const stat = await fs.promises.stat(filePath);
  resolvedMapFileSizeCache.set(filePath, stat.size);
  return stat.size;
}

export function clearMapFilePathCache() {
  resolvedMapFilePathCache.clear();
  resolvedMapFileSizeCache.clear();
}

export function isPathInside(parent: string, child: string): boolean {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);
  const relative = path.relative(parentResolved, childResolved);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function sanitizeMapFilename(filename: string): string | null {
  if (!filename || filename.includes('\0')) return null;

  const raw = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (raw === '' || raw.includes('://')) return null;

  const normalized = path.posix.normalize(raw);
  if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) return null;
  if (normalized.split('/').includes('..')) return null;

  const ext = path.posix.extname(normalized).toLowerCase();
  if (!ALLOWED_MAP_EXTENSIONS.has(ext)) return null;

  return normalized;
}

export function resolveSafeMapFile(filename: string, dirs: string[]): string | null {
  const sanitized = sanitizeMapFilename(filename);
  if (!sanitized) return null;

  const cached = resolvedMapFilePathCache.get(sanitized);
  if (cached) return cached;

  const candidates: Array<{ dir: string; rel: string }> = [];
  for (const dir of dirs) {
    if (!dir) continue;
    candidates.push({ dir, rel: sanitized });
    if (sanitized.startsWith('sprites/')) {
      candidates.push({ dir, rel: sanitized.slice('sprites/'.length) });
    }
    if (sanitized.startsWith('fonts/')) {
      candidates.push({ dir, rel: sanitized.slice('fonts/'.length) });
    }
  }

  for (const { dir, rel } of candidates) {
    const resolvedDir = path.resolve(dir);
    const resolvedFile = path.resolve(resolvedDir, rel);
    if (!isPathInside(resolvedDir, resolvedFile)) continue;

    try {
      if (fs.existsSync(resolvedFile) && !fs.statSync(resolvedFile).isDirectory()) {
        resolvedMapFilePathCache.set(sanitized, resolvedFile);
        return resolvedFile;
      }
    } catch {
      // Ignore filesystem permission read errors
    }
  }

  return null;
}

export function getSafeFontDownloadTarget(
  filename: string,
  dataRoot: string
): { targetPath: string; targetDir: string } | null {
  const sanitized = sanitizeMapFilename(filename);
  if (!sanitized || !sanitized.startsWith('fonts/') || !sanitized.endsWith('.pbf')) {
    return null;
  }

  const dataRootResolved = path.resolve(dataRoot);
  const targetPath = path.resolve(dataRootResolved, sanitized);
  if (!isPathInside(dataRootResolved, targetPath)) return null;

  return { targetPath, targetDir: path.dirname(targetPath) };
}

const fontDownloadInflight = new Map<string, Promise<string | null>>();

export function clearFontDownloadInflightForTests() {
  fontDownloadInflight.clear();
}

export async function ensureOnDemandFontFile(
  sanitizedName: string,
  dataRoot: string
): Promise<string | null> {
  const existing = fontDownloadInflight.get(sanitizedName);
  if (existing) return existing;

  const promise = (async () => {
    const safeTarget = getSafeFontDownloadTarget(sanitizedName, dataRoot);
    if (!safeTarget) return null;

    try {
      await fs.promises.access(safeTarget.targetPath);
      return safeTarget.targetPath;
    } catch {
      // Download below
    }

    const upstreamUrl = `https://protomaps.github.io/basemaps-assets/${sanitizedName.split('/').map(encodeURIComponent).join('/')}`;
    const response = await fetch(upstreamUrl);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.mkdir(safeTarget.targetDir, { recursive: true });
    const tempPath = `${safeTarget.targetPath}.${process.pid}.tmp`;
    try {
      await fs.promises.writeFile(tempPath, buffer);
      await fs.promises.rename(tempPath, safeTarget.targetPath);
    } catch (err) {
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
    return safeTarget.targetPath;
  })().finally(() => {
    fontDownloadInflight.delete(sanitizedName);
  });

  fontDownloadInflight.set(sanitizedName, promise);
  return promise;
}

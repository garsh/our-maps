import fs from 'fs';
import path from 'path';

const ALLOWED_MAP_EXTENSIONS = new Set(['.pmtiles', '.pbf', '.png', '.json']);

export const PMTILES_MAX_RANGE_BYTES = 8 * 1024 * 1024;

const MAP_ASSET_SUBDIRS = [
  'data/maps',
  'data/sprites',
  'data/fonts',
  'server/public/maps',
  'server/public/sprites',
  'server/public/fonts',
  'public/maps',
  'public/sprites',
  'public/fonts',
] as const;

function isFilesystemRoot(p: string): boolean {
  const resolved = path.resolve(p);
  return path.parse(resolved).root === resolved;
}

/** Allowlisted maps/sprites/fonts dirs only — never `/` or `/data` as a tile root. */
export function buildCandidateMapsDirs(options?: {
  cwd?: string;
  extraRoots?: string[];
  mapsDir?: string;
}): string[] {
  const cwd = options?.cwd ?? process.cwd();
  const extraRoots = options?.extraRoots ?? [];
  const searchRoots = [cwd, ...extraRoots].filter((root) => root && !isFilesystemRoot(root));
  const mapsDir = options?.mapsDir ?? process.env.MAPS_DIR;
  const dirs = [
    mapsDir,
    ...searchRoots.flatMap((root) => MAP_ASSET_SUBDIRS.map((sub) => path.resolve(root, sub))),
  ].filter((d): d is string => Boolean(d));
  return Array.from(new Set(dirs));
}

type FileRangeResult =
  | { ok: true; start: number; end: number }
  | { ok: false; status: 400 | 416; error: string };

export function evaluateFileRange(
  rangeHeader: string | undefined,
  total: number,
  limits?: { requireRange?: boolean; maxBytes?: number }
): FileRangeResult {
  const requireRange = limits?.requireRange ?? false;
  const maxBytes = limits?.maxBytes;

  if (!rangeHeader) {
    if (requireRange) {
      return { ok: false, status: 400, error: 'Range header required' };
    }
    if (total <= 0) {
      return { ok: true, start: 0, end: -1 };
    }
    return { ok: true, start: 0, end: total - 1 };
  }

  const raw = rangeHeader.trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(raw);
  if (!match) {
    return { ok: false, status: 416, error: 'Invalid range' };
  }

  const start = match[1] === '' ? 0 : Number.parseInt(match[1], 10);
  const end = match[2] === '' ? total - 1 : Number.parseInt(match[2], 10);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < 0 ||
    start >= total ||
    end >= total ||
    start > end
  ) {
    return { ok: false, status: 416, error: 'Range not satisfiable' };
  }

  const length = end - start + 1;
  if (maxBytes !== undefined && length > maxBytes) {
    return { ok: false, status: 416, error: 'Range too large' };
  }

  return { ok: true, start, end };
}

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

  const realAllowlistedDirs: string[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      const resolvedDir = path.resolve(dir);
      realAllowlistedDirs.push(fs.existsSync(resolvedDir) ? fs.realpathSync(resolvedDir) : resolvedDir);
    } catch {
      realAllowlistedDirs.push(path.resolve(dir));
    }
  }

  for (const { dir, rel } of candidates) {
    const resolvedDir = path.resolve(dir);
    const resolvedFile = path.resolve(resolvedDir, rel);
    if (!isPathInside(resolvedDir, resolvedFile)) continue;

    try {
      if (fs.existsSync(resolvedFile) && !fs.statSync(resolvedFile).isDirectory()) {
        const realFile = fs.realpathSync(resolvedFile);
        const insideAllowlist = realAllowlistedDirs.some(
          (allowed) => realFile === allowed || isPathInside(allowed, realFile)
        );
        if (!insideAllowlist) continue;
        resolvedMapFilePathCache.set(sanitized, realFile);
        return realFile;
      }
    } catch {
      // Ignore filesystem permission read errors
    }
  }

  return null;
}

const ALLOWED_FONTSTACKS = new Set([
  'Noto Sans Regular',
  'Noto Sans Medium',
  'Noto Sans Italic',
  'Noto Sans Devanagari Regular v1'
]);

export function isAllowedFontstack(fontFilename: string): boolean {
  if (!fontFilename.startsWith('fonts/')) return false;
  const parts = fontFilename.slice('fonts/'.length).split('/');
  if (parts.length !== 2) return false;
  const fontstack = parts[0];
  const file = parts[1];
  if (!ALLOWED_FONTSTACKS.has(fontstack)) return false;
  return /^\d+-\d+\.pbf$/.test(file);
}

export function getSafeFontDownloadTarget(
  filename: string,
  dataRoot: string
): { targetPath: string; targetDir: string } | null {
  const sanitized = sanitizeMapFilename(filename);
  if (!sanitized || !isAllowedFontstack(sanitized)) {
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

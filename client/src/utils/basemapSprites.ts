import lightJson from '../assets/basemap-sprites/light@2x.json';
import darkJson from '../assets/basemap-sprites/dark@2x.json';
import lightPng from '../assets/basemap-sprites/light@2x.png?inline';
import darkPng from '../assets/basemap-sprites/dark@2x.png?inline';

interface SpriteMeta {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio?: number;
  sdf?: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode bundled basemap sprite'));
    img.src = src;
  });
}

interface ExtractedSprite {
  id: string;
  imageData: ImageData;
  pixelRatio: number;
  sdf: boolean;
}

const spriteCache = new Map<'light' | 'dark', Promise<ExtractedSprite[]>>();

function ensureSprites(theme: 'light' | 'dark'): Promise<ExtractedSprite[]> {
  let cached = spriteCache.get(theme);
  if (!cached) {
    cached = extractSprites(theme);
    spriteCache.set(theme, cached);
  }
  return cached;
}

/** Decode bundled atlases immediately so style.load can register icons before tiles ask for them. */
function prefetchBundledSprites() {
  void ensureSprites('light');
  void ensureSprites('dark');
}

export function isBundledSpriteId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(lightJson, id)
    || Object.prototype.hasOwnProperty.call(darkJson, id);
}

export async function applyBundledSpriteById(map: any, id: string, theme?: 'light' | 'dark'): Promise<boolean> {
  if (!map || typeof map.addImage !== 'function' || !id) return false;
  const order: Array<'light' | 'dark'> = theme
    ? [theme, theme === 'light' ? 'dark' : 'light']
    : ['light', 'dark'];
  for (const t of order) {
    const sprites = await ensureSprites(t);
    const sprite = sprites.find((s) => s.id === id);
    if (!sprite) continue;
    try {
      if (typeof map.hasImage === 'function' && map.hasImage(id)) {
        map.removeImage(id);
      }
      map.addImage(id, sprite.imageData, { pixelRatio: sprite.pixelRatio, sdf: sprite.sdf });
      return true;
    } catch {
      // ignore duplicate-id races
    }
  }
  return false;
}

async function extractSprites(theme: 'light' | 'dark'): Promise<ExtractedSprite[]> {
  const json = (theme === 'dark' ? darkJson : lightJson) as Record<string, SpriteMeta>;
  const png = theme === 'dark' ? darkPng : lightPng;
  const img = await loadImage(png);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const list: ExtractedSprite[] = [];
  for (const [id, meta] of Object.entries(json)) {
    canvas.width = meta.width;
    canvas.height = meta.height;
    ctx.clearRect(0, 0, meta.width, meta.height);
    ctx.drawImage(img, meta.x, meta.y, meta.width, meta.height, 0, 0, meta.width, meta.height);
    const imageData = ctx.getImageData(0, 0, meta.width, meta.height);
    list.push({
      id,
      imageData,
      pixelRatio: meta.pixelRatio || 2,
      sdf: Boolean(meta.sdf),
    });
  }
  return list;
}

export async function applyBundledSprites(map: any, theme: 'light' | 'dark'): Promise<number> {
  if (!map || typeof map.addImage !== 'function') return 0;
  const sprites = await ensureSprites(theme);

  let added = 0;
  for (const sprite of sprites) {
    try {
      if (typeof map.hasImage === 'function' && map.hasImage(sprite.id)) {
        map.removeImage(sprite.id);
      }
      map.addImage(sprite.id, sprite.imageData, { pixelRatio: sprite.pixelRatio, sdf: sprite.sdf });
      added++;
    } catch {
      // ignore duplicate-id races
    }
  }
  if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
  return added;
}

export function bundledSpriteIconCount(theme: 'light' | 'dark'): number {
  const json = theme === 'dark' ? darkJson : lightJson;
  return Object.keys(json).length;
}

prefetchBundledSprites();

import type { Pin, PinIcon } from '@shared/interfaces';
import { ICON_SVG_PATHS, resolvePinColorCode } from './mapUtils';

const registeredImages = new Set<string>();
const pendingImages = new Map<string, Promise<boolean>>();

export function getPinIconKey(color?: string | null, icon?: string | null): string {
  const colorCode = resolvePinColorCode(color);
  const iconName = (icon && icon in ICON_SVG_PATHS) ? icon : 'default';
  return `pin-${colorCode}-${iconName}`;
}

/** Parse `pin-#2A81CB-default` into color + icon. Returns null for non-pin ids. */
export function parsePinIconKey(key: string): { colorCode: string; iconKey: string } | null {
  if (!key.startsWith('pin-')) return null;
  const rest = key.slice(4);
  const lastDash = rest.lastIndexOf('-');
  if (lastDash <= 0 || lastDash === rest.length - 1) return null;
  const colorCode = rest.slice(0, lastDash);
  const iconKey = rest.slice(lastDash + 1);
  if (!colorCode || !iconKey) return null;
  return { colorCode, iconKey };
}

export function buildPinSvg(colorCode: string, iconKey: string): string {
  const iconPath = (iconKey !== 'default' && iconKey in ICON_SVG_PATHS)
    ? ICON_SVG_PATHS[iconKey as Exclude<PinIcon, 'default'>]
    : null;

  const innerIcon = iconPath
    ? `<g transform="translate(4.5, 4.5) scale(0.85)" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">${iconPath}</g>`
    : `<circle cx="15" cy="15" r="6" fill="white" fill-opacity="0.9" />`;

  return `<svg width="60" height="84" viewBox="0 0 30 42" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#000000" flood-opacity="0.4"/>
      </filter>
    </defs>
    <g filter="url(#shadow)">
      <path d="M15 0C6.71573 0 0 6.71573 0 15C0 26.25 15 42 15 42C15 42 30 26.25 30 15C30 6.71573 23.2843 0 15 0Z" fill="${colorCode}"/>
      ${innerIcon}
    </g>
  </svg>`;
}

async function loadSvgImage(svgString: string): Promise<any> {
  return new Promise((resolve) => {
    const img = new Image();
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

    img.onload = () => {
      try {
        if (typeof document !== 'undefined') {
          const canvas = document.createElement('canvas');
          canvas.width = 60;
          canvas.height = 84;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, 60, 84);
            const imageData = ctx.getImageData(0, 0, 60, 84);
            resolve({ width: 60, height: 84, data: imageData.data });
            return;
          }
        }
      } catch {}
      resolve(img);
    };

    img.onerror = () => {
      resolve(img);
    };

    img.src = dataUrl;

    // Fallback for Node/JSDOM test environments
    setTimeout(() => {
      resolve(img);
    }, 200);
  });
}

/**
 * Registers a single pin sprite on the map, keyed like `pin-#2A81CB-default`.
 * Safe to call from MapLibre's missing-image resolver: waits until addImage
 * has completed (or the image is already present) before resolving.
 * Returns true if this call newly registered the image.
 */
export async function ensurePinImageByKey(map: any, key: string): Promise<boolean> {
  if (!map || !key) return false;
  if (typeof map.hasImage === 'function' && map.hasImage(key)) {
    registeredImages.add(key);
    return false;
  }

  const inflight = pendingImages.get(key);
  if (inflight) {
    await inflight;
    return false;
  }

  const parsed = parsePinIconKey(key);
  if (!parsed) return false;

  const promise = (async (): Promise<boolean> => {
    try {
      const svg = buildPinSvg(parsed.colorCode, parsed.iconKey);
      const img = await loadSvgImage(svg);
      if (typeof map.hasImage === 'function' && map.hasImage(key)) {
        registeredImages.add(key);
        return false;
      }
      map.addImage(key, img, { pixelRatio: 2 });
      registeredImages.add(key);
      return true;
    } catch (err) {
      console.warn(`Failed to register pin icon sprite for ${key}:`, err);
      return false;
    } finally {
      pendingImages.delete(key);
    }
  })();

  pendingImages.set(key, promise);
  return promise;
}

/**
 * Ensures all unique color/icon combination images used by the given pins
 * are registered in the MapLibre map instance.
 */
export async function ensurePinImages(map: any, pins: Pin[]): Promise<void> {
  if (!map || !pins || pins.length === 0) return;

  const keys = new Set<string>();
  for (const pin of pins) {
    keys.add(getPinIconKey(pin.color, pin.icon));
  }

  const results = await Promise.all([...keys].map((key) => ensurePinImageByKey(map, key)));
  if (results.some(Boolean) && typeof map.triggerRepaint === 'function') {
    map.triggerRepaint();
  }
}

export function clearRegisteredImages(): void {
  registeredImages.clear();
  pendingImages.clear();
}

import type { Pin, PinColor, PinIcon } from '@shared/interfaces';

export const DEFAULT_PIN_COLOR: PinColor = 'blue';
export const DEFAULT_PIN_ICON: PinIcon = 'default';

export function arePinsEqual(a?: Pin | null, b?: Pin | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.lat === b.lat &&
    a.lng === b.lng &&
    (a.label || '') === (b.label || '') &&
    (a.description || '') === (b.description || '') &&
    (a.address || '') === (b.address || '') &&
    (a.color || 'blue') === (b.color || 'blue') &&
    (a.icon || 'default') === (b.icon || 'default') &&
    (a.position || 0) === (b.position || 0) &&
    (a.layerId || undefined) === (b.layerId || undefined)
  );
}

export const COLOR_CODES: Record<string, string> = {
  red: '#CB2B3E',
  orange: '#CB8427',
  gold: '#FFD700',
  green: '#2AAD27',
  teal: '#008080',
  blue: '#2A81CB',
  electric_blue: '#0028FF',
  violet: '#9C2BCB',
  pink: '#FF69B4',
  brown: '#8B4513',
  black: '#000000',
};

export const PIN_COLORS = Object.entries(COLOR_CODES).map(([name, value]) => ({ name, value }));

export function formatColorName(colorNameOrHex: string): string {
  if (colorNameOrHex.startsWith('#')) {
    return `Custom color: ${colorNameOrHex}`;
  }
  return colorNameOrHex
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export const VALID_PIN_ICONS: readonly PinIcon[] = [
  'default',
  'hotel',
  'restaurant',
  'airport',
  'car',
  'bus',
  'boat',
  'train',
  'gas',
  'charging',
  'shopping',
] as const;

export const DEFAULT_ICON_COLORS: Record<PinIcon, PinColor> = {
  default: 'blue',
  hotel: 'violet',
  restaurant: 'green',
  airport: 'black',
  car: 'black',
  bus: 'black',
  boat: 'black',
  train: 'black',
  gas: 'brown',
  charging: 'brown',
  shopping: 'pink',
};

export function getDefaultColorForIcon(icon?: PinIcon): PinColor {
  if (!icon || !(icon in DEFAULT_ICON_COLORS)) {
    return DEFAULT_PIN_COLOR;
  }
  return DEFAULT_ICON_COLORS[icon];
}

export function isValidPinIcon(icon?: string | null): icon is PinIcon {
  return typeof icon === 'string' && (VALID_PIN_ICONS as readonly string[]).includes(icon);
}

export function isValidPinColor(color?: string | null): boolean {
  if (!color || typeof color !== 'string') return false;
  return color.startsWith('#') || color in COLOR_CODES;
}

export function resolvePinColorCode(color?: string | null): string {
  if (!color) return COLOR_CODES[DEFAULT_PIN_COLOR];
  if (color.startsWith('#')) return color;
  return COLOR_CODES[color] || COLOR_CODES[DEFAULT_PIN_COLOR];
}

export const ICON_SVG_PATHS: Record<Exclude<PinIcon, 'default'>, string> = {
  hotel: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  restaurant: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  airport: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  shopping: '<path d="M2.048 18.566A2 2 0 0 0 4 21h16a2 2 0 0 0 1.952-2.434l-2-9A2 2 0 0 0 18 8H6a2 2 0 0 0-1.952 1.566z"/><path d="M8 11V6a4 4 0 0 1 8 0v5"/>',
  car: '<path d="M 22 16 v -5.5 a 2.5 2.5 0 0 0 -2.5 -2.5 h -4.5 l -3 -5 h -6 l -4 8 v 4 a 1 1 0 0 0 1 1 h 1 M 10 16 h 4 M 20 16 h 2"/><circle cx="7" cy="16" r="3"/><circle cx="17" cy="16" r="3"/>',
  bus: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  gas: '<path d="M3 22L17 22"/><path d="M4 22V4C4 3.44772 4.44772 3 5 3H15C15.5523 3 16 3.44772 16 4V22"/><path d="M19 7H22"/><path d="M18 10V6C18 5.44772 18.4477 5 19 5H22C22.5523 5 23 5.44772 23 6V20C23 20.5523 22.5523 21 22 21H20"/><path d="M7 7H13V11H7V7Z"/>',
  charging: '<path d="M11 2L5.5 12H11L9.5 22L19 10H12L14 2H11Z"/>',
  boat: '<path d="M 4 18 h 16 c 1.5 0 2 -1.5 2 -4 c 0 -1.5 -0.5 -2 -2 -2 h -16 c -1.5 0 -2 0.5 -2 2 c 0 2.5 0.5 4 2 4 Z M 12 12 V 2 c 0 -1.5 -1 -1.5 -2 -0.5 l -6 9 c -0.5 1 0 1.5 1 1.5 h 7"/>',
  train: '<path d="M 20 16 h 1 c 1 0 2 -0.5 2 -2 v -3 c 0 -1.5 -0.5 -2 -2 -2 h -1 v -3 c 0 -1 -1 -2 -2 -2 h -2 c -1 0 -2 1 -2 2 v 3 h -4 v -4 c 0 -1.5 -1 -3 -3 -3 h -2 c -1.5 0 -3 1.5 -3 3 v 9 c 0 1.5 1 2 2 2 M 10 16 h 4"/><circle cx="7" cy="16" r="3"/><circle cx="17" cy="16" r="3"/>'
};

export function getPreviewMarkerHTML() {
  const width = 20;
  const height = 28;
  const pinPath = 'M15 0C6.71573 0 0 6.71573 0 15C0 26.25 15 42 15 42C15 42 30 26.25 30 15C30 6.71573 23.2843 0 15 0Z';
  const rainbow = 'linear-gradient(135deg, #b91c1c 0%, #c2410c 10%, #15803d 20%, #1d4ed8 30%, #6b21a8 40%, #b91c1c 50%, #c2410c 60%, #15803d 70%, #1d4ed8 80%, #6b21a8 90%, #b91c1c 100%)';

  // Same 20x28 box as PinMarker so anchor=bottom puts the tip on the lat/lng.
  const html = `
    <div style="
      position: relative;
      width: ${width}px;
      height: ${height}px;
    ">
      <div style="
        position: absolute;
        top: -20px;
        left: -20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.12);
        z-index: -1;
        pointer-events: none;
        animation: pulse 1.2s infinite;
      ">
        <div style="
          position: absolute;
          inset: 0;
          border-radius: 50%;
          padding: 3px;
          background: ${rainbow};
          background-size: 600% 600%;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          animation: rainbowMove 30s linear infinite;
        "></div>
      </div>
      <svg
        width="${width}"
        height="${height}"
        viewBox="0 0 30 42"
        xmlns="http://www.w3.org/2000/svg"
        style="display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4)); pointer-events: none;"
      >
        <defs>
          <linearGradient id="preview-pin-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#b91c1c" />
            <stop offset="20%" stop-color="#15803d" />
            <stop offset="40%" stop-color="#1d4ed8" />
            <stop offset="60%" stop-color="#6b21a8" />
            <stop offset="80%" stop-color="#c2410c" />
            <stop offset="100%" stop-color="#b91c1c" />
          </linearGradient>
        </defs>
        <path d="${pinPath}" fill="url(#preview-pin-fill)" />
        <circle cx="15" cy="15" r="6" fill="white" fill-opacity="0.9" />
      </svg>
    </div>
  `;

  return { html, className: 'custom-pin-modern hovered', width, height };
}

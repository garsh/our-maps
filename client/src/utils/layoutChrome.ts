export const MOBILE_LAYOUT_MAX_WIDTH = 768;
export const DEFAULT_SIDEBAR_WIDTH = 400;

export function layoutOrientation(): 'portrait' | 'landscape' {
  if (typeof window === 'undefined') return 'portrait';
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

export function viewportIsMobile() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_LAYOUT_MAX_WIDTH;
}

export function standardSheetHeight() {
  if (typeof window === 'undefined') return 300;
  return Math.min(350, Math.round(window.innerHeight * 0.45));
}

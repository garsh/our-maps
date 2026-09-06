export interface ClampedBounds {
  boundWest: number;
  boundEast: number;
  boundNorth: number;
  boundSouth: number;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function parseAndClampBounds(bounds?: string | null): ClampedBounds | null {
  if (!bounds) return null;
  const parts = bounds.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) return null;

  const [west, north, east, south] = parts;
  const minLat = Math.min(north, south);
  const maxLat = Math.max(north, south);
  const minLng = Math.min(west, east);
  const maxLng = Math.max(west, east);

  return {
    boundWest: Math.max(-180, minLng),
    boundEast: Math.min(180, maxLng),
    boundNorth: Math.min(90, maxLat),
    boundSouth: Math.max(-90, minLat),
    minLat,
    maxLat,
    minLng,
    maxLng,
  };
}

export function isWorldBounds(bounds: ClampedBounds | null | undefined): boolean {
  if (!bounds) return true;
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  // If bounds span almost entire longitude (>= 340) and broad latitude (>= 120), or world clamping reached
  if (lngSpan >= 340 && latSpan >= 120) return true;
  if (bounds.boundEast - bounds.boundWest >= 350 && bounds.boundNorth - bounds.boundSouth >= 140) return true;
  return false;
}

export function isWithinBounds(
  latVal: number | string | undefined | null,
  lngVal: number | string | undefined | null,
  bounds: ClampedBounds | null
): boolean {
  if (!bounds || isWorldBounds(bounds)) return true;
  if (latVal === undefined || latVal === null || lngVal === undefined || lngVal === null) return true;
  const lat = typeof latVal === 'number' ? latVal : parseFloat(latVal);
  const lng = typeof lngVal === 'number' ? lngVal : parseFloat(lngVal);
  if (isNaN(lat) || isNaN(lng)) return true;
  return lat >= bounds.boundSouth && lat <= bounds.boundNorth && lng >= bounds.boundWest && lng <= bounds.boundEast;
}

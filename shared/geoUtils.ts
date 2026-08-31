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

export function isWithinBounds(
  latVal: number | string | undefined | null,
  lngVal: number | string | undefined | null,
  bounds: ClampedBounds | null
): boolean {
  if (!bounds) return true;
  if (latVal === undefined || latVal === null || lngVal === undefined || lngVal === null) return true;
  const lat = typeof latVal === 'number' ? latVal : parseFloat(latVal);
  const lng = typeof lngVal === 'number' ? lngVal : parseFloat(lngVal);
  if (isNaN(lat) || isNaN(lng)) return true;
  return lat >= bounds.boundSouth && lat <= bounds.boundNorth && lng >= bounds.boundWest && lng <= bounds.boundEast;
}

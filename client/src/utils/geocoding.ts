import { apiService } from '../services/api';

const GEO_CACHE_MAX = 200;
const geoCache = new Map<string, string>();
const geoInflight = new Map<string, Promise<string | null>>();

/** Same rounding as the server reverse-geocode cache (`lat.toFixed(4)`). */
function geocodeCacheKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

export function clearGeocodeCacheForTests(): void {
  geoCache.clear();
  geoInflight.clear();
}

function rememberGeocode(key: string, address: string): void {
  while (geoCache.size >= GEO_CACHE_MAX) {
    const oldest = geoCache.keys().next().value;
    if (oldest === undefined) break;
    geoCache.delete(oldest);
  }
  geoCache.set(key, address);
}

async function fetchGeocode(lat: number, lng: number, key: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const address = await apiService.reverseGeocode(lat, lng, signal);
    if (signal?.aborted) return null;
    if (address) rememberGeocode(key, address);
    return address;
  } catch (error: any) {
    if (signal?.aborted || error?.name === 'AbortError') return null;
    console.error('Reverse geocoding failed with error:', error);
    return null;
  }
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return null;
  const key = geocodeCacheKey(lat, lng);
  const cached = geoCache.get(key);
  if (cached !== undefined) {
    geoCache.delete(key);
    geoCache.set(key, cached);
    return cached;
  }

  // A caller that can abort must own its request. Sharing it with the
  // unsignaled in-flight map would cancel a lookup someone else still needs.
  if (signal) return fetchGeocode(lat, lng, key, signal);

  const inflight = geoInflight.get(key);
  if (inflight) return inflight;

  const pending = fetchGeocode(lat, lng, key);
  geoInflight.set(key, pending);
  pending.finally(() => {
    if (geoInflight.get(key) === pending) geoInflight.delete(key);
  });
  return pending;
}

import { apiService } from '../services/api';

const GEO_CACHE_MAX = 200;
const geoCache = new Map<string, string>();
const geoInflight = new Map<string, Promise<string | null>>();

/** Same rounding as the server reverse-geocode cache (`lat.toFixed(4)`). */
export function geocodeCacheKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

export function clearGeocodeCacheForTests(): void {
  geoCache.clear();
  geoInflight.clear();
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = geocodeCacheKey(lat, lng);
  const cached = geoCache.get(key);
  if (cached !== undefined) {
    geoCache.delete(key);
    geoCache.set(key, cached);
    return cached;
  }

  const inflight = geoInflight.get(key);
  if (inflight) return inflight;

  const pending = (async () => {
    try {
      const address = await apiService.reverseGeocode(lat, lng);
      if (address) {
        while (geoCache.size >= GEO_CACHE_MAX) {
          const oldest = geoCache.keys().next().value;
          if (oldest === undefined) break;
          geoCache.delete(oldest);
        }
        geoCache.set(key, address);
      }
      return address;
    } catch (error) {
      console.error('Reverse geocoding failed with error:', error);
      return null;
    } finally {
      geoInflight.delete(key);
    }
  })();

  geoInflight.set(key, pending);
  return pending;
}

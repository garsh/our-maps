import { apiService } from '../services/api';

/** @internal - For testing compatibility */
export function resetGeocodingState() {
  // No-op kept for backwards compatibility in test suites
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    return await apiService.reverseGeocode(lat, lng);
  } catch (error) {
    console.error('Reverse geocoding failed with error:', error);
    return null;
  }
}

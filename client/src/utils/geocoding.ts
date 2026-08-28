import { apiService } from '../services/api';

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    return await apiService.reverseGeocode(lat, lng);
  } catch (error) {
    console.error('Reverse geocoding failed with error:', error);
    return null;
  }
}

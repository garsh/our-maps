import { apiService } from '../services/api';

let lastRequestTime = 0;
const MIN_DELAY = 1200; // 1.2 seconds to be safe

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Serialization queue
let queue: Promise<any> = Promise.resolve();

/** @internal - For testing only */
export function resetGeocodingState() {
  lastRequestTime = 0;
  queue = Promise.resolve();
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  // Add this request to the queue
  return new Promise((resolve) => {
    queue = queue.then(async () => {
      const result = await performRequest(lat, lng);
      resolve(result);
    });
  });
}

async function performRequest(lat: number, lng: number): Promise<string | null> {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  
  if (timeSinceLast < MIN_DELAY) {
    const delay = MIN_DELAY - timeSinceLast;
    await wait(delay);
  }
  
  lastRequestTime = Date.now();

  try {
    return await apiService.reverseGeocode(lat, lng);
  } catch (error) {
    console.error('Reverse geocoding failed with error:', error);
    return null;
  }
}

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

async function performRequest(lat: number, lng: number, retryCount = 0): Promise<string | null> {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  
  if (timeSinceLast < MIN_DELAY) {
    const delay = MIN_DELAY - timeSinceLast;
    await wait(delay);
  }
  
  lastRequestTime = Date.now();

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'OurMaps-App-Simple/1.0 (contact: zach@example.com)'
        }
      }
    );
    
    if (response.status === 429) {
      if (retryCount < 2) {
        console.warn(`Geocoding rate limited (429). Retry ${retryCount + 1}...`);
        await wait(2000);
        return performRequest(lat, lng, retryCount + 1);
      }
      return null;
    }

    if (!response.ok) {
      console.error(`Reverse geocoding failed with status: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    return data.display_name || null;
  } catch (error) {
    //TypeError is often a CORS block on a 429/403 page
    if (error instanceof TypeError && retryCount < 2) {
      console.warn(`Fetch error in geocoding (possibly CORS block on error page). Retry ${retryCount + 1}...`);
      await wait(2000);
      return performRequest(lat, lng, retryCount + 1);
    }
    console.error('Reverse geocoding failed with error:', error);
    return null;
  }
}

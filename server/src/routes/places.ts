import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../auth';

const router = Router();

// Apply auth middleware to require login for proxy requests
router.use(authMiddleware);

// GET /api/places/search?q=QUERY&bounds=BOUNDS
router.get('/search', async (req: AuthRequest, res) => {
  const query = req.query.q as string;
  const bounds = req.query.bounds as string; // west,north,east,south

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.warn('[Places API] GOOGLE_MAPS_API_KEY not set. Falling back to Nominatim.');
    try {
      let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10`;
      if (bounds) {
        url += `&viewbox=${encodeURIComponent(bounds)}`;
      }
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OurMaps-App/1.0' }
      });
      const data = await response.json();
      const formatted = data.map((item: any) => ({
        place_id: item.place_id,
        display_name: item.display_name,
        lat: item.lat,
        lon: item.lon,
        type: 'global'
      }));
      return res.json(formatted);
    } catch (err: any) {
      console.error('[Places API] Nominatim fallback failed:', err);
      return res.status(502).json({ error: 'Search failed' });
    }
  }

  try {
    const url = 'https://places.googleapis.com/v1/places:searchText';

    const body: Record<string, any> = {
      textQuery: query,
      maxResultCount: 10
    };

    if (bounds) {
      // bounds: west,north,east,south
      const parts = bounds.split(',').map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        const [west, north, east, south] = parts;
        const centerLat = (north + south) / 2;
        const centerLng = (west + east) / 2;
        // Simple radius calculation in meters (rough estimate)
        const latDiff = Math.abs(north - south);
        const radius = Math.max(500, Math.min(50000, Math.round(latDiff * 111000)));
        body.locationBias = {
          circle: {
            center: { latitude: centerLat, longitude: centerLng },
            radius
          }
        };
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();

    if (data.error) {
      console.error('[Places API] Google search returned error:', data.error.message);
      return res.status(502).json({ error: `Google API error: ${data.error.message}` });
    }

    const results = data.places || [];
    const formatted = results.map((item: any) => ({
      place_id: item.id || '',
      display_name: (item.displayName?.text || '') + (item.formattedAddress ? `, ${item.formattedAddress}` : ''),
      lat: item.location?.latitude?.toString() || '0',
      lon: item.location?.longitude?.toString() || '0',
      type: 'global'
    }));

    return res.json(formatted);
  } catch (err: any) {
    console.error('[Places API] Google search failed:', err);
    return res.status(502).json({ error: 'Search failed' });
  }
});

// GET /api/places/reverse-geocode?lat=LAT&lng=LNG
router.get('/reverse-geocode', async (req: AuthRequest, res) => {
  const lat = req.query.lat as string;
  const lng = req.query.lng as string;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.warn('[Places API] GOOGLE_MAPS_API_KEY not set. Falling back to Nominatim.');
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OurMaps-App/1.0' }
      });
      const data = await response.json();
      return res.json({ address: data.display_name || null });
    } catch (err: any) {
      console.error('[Places API] Nominatim fallback reverse geocode failed:', err);
      return res.status(502).json({ error: 'Reverse geocode failed' });
    }
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('[Places API] Google reverse geocode returned status:', data.status, data.error_message);
      return res.status(502).json({ error: `Google API error: ${data.status}` });
    }

    const address = data.results?.[0]?.formatted_address || null;
    return res.json({ address });
  } catch (err: any) {
    console.error('[Places API] Google reverse geocode failed:', err);
    return res.status(502).json({ error: 'Reverse geocode failed' });
  }
});

export default router;

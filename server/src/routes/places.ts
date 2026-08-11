import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../auth';

const STATE_ABBREVIATIONS: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
  'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
  'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
  'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  'District of Columbia': 'DC', 'Puerto Rico': 'PR'
};

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

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  if (!apiKey) {
    console.warn('[Places API] GOOGLE_MAPS_API_KEY is not set or empty. Falling back to Nominatim.');
    try {
      let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=30&addressdetails=1`;
      let centerLat: number | null = null;
      let centerLng: number | null = null;
      
      if (bounds) {
        const parts = bounds.split(',').map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
          const [west, north, east, south] = parts;
          centerLat = (north + south) / 2;
          centerLng = (west + east) / 2;
          
          const width = Math.abs(east - west);
          const height = Math.abs(north - south);
          
          // Expand by 50% on each side
          const expWest = west - (width * 0.5);
          const expEast = east + (width * 0.5);
          const expNorth = north + (height * 0.5);
          const expSouth = south - (height * 0.5);
          
          const expandedBounds = `${expWest},${expNorth},${expEast},${expSouth}`;
          url += `&viewbox=${encodeURIComponent(expandedBounds)}&bounded=1`;
        } else {
          url += `&viewbox=${encodeURIComponent(bounds)}&bounded=1`;
        }
      }
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OurMaps-App/1.0' }
      });
      const data = await response.json();
      let formatted = data.map((item: any) => {
        let title = '';
        let address = item.display_name;
        if (item.address) {
          const firstPart = item.display_name.split(',')[0].trim();
          let road = item.address.road || '';
          if (item.address.house_number && road) road = `${item.address.house_number} ${road}`;
          
          const parts = [];
          if (firstPart !== item.address.house_number && !road.startsWith(firstPart)) {
            title = firstPart;
          }
          if (road) parts.push(road);
          
          const city = item.address.city || item.address.town || item.address.village || item.address.suburb;
          let state = item.address.state;
          if (state && STATE_ABBREVIATIONS[state]) {
            state = STATE_ABBREVIATIONS[state];
          }
          const postcode = item.address.postcode;
          
          parts.push(city, state, postcode);
          const validParts = parts.filter(Boolean).map(s => String(s).trim());
          address = Array.from(new Set(validParts)).join(', ');
        }
        return {
          place_id: item.place_id,
          title,
          address,
          lat: item.lat,
          lon: item.lon,
          type: 'global'
        };
      });

      if (centerLat !== null && centerLng !== null) {
        formatted.sort((a: any, b: any) => {
          const distA = Math.pow(parseFloat(a.lat) - centerLat!, 2) + Math.pow(parseFloat(a.lon) - centerLng!, 2);
          const distB = Math.pow(parseFloat(b.lat) - centerLat!, 2) + Math.pow(parseFloat(b.lon) - centerLng!, 2);
          return distA - distB;
        });
      }

      return res.json(formatted.slice(0, 10));
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
    const formatted = results.map((item: any) => {
      let formattedAddress = item.formattedAddress || '';
      formattedAddress = formattedAddress.replace(/,\s*(USA|United States|United States of America)$/i, '');
      return {
        place_id: item.id || '',
        title: item.displayName?.text || '',
        address: formattedAddress,
        lat: item.location?.latitude?.toString() || '0',
        lon: item.location?.longitude?.toString() || '0',
        type: 'global'
      };
    });

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
      let cleanAddress = data.display_name || null;
      if (data.address) {
        const firstPart = (data.display_name || '').split(',')[0].trim();
        let road = data.address.road || '';
        if (data.address.house_number && road) road = `${data.address.house_number} ${road}`;
        
        const parts = [];
        if (firstPart !== data.address.house_number && !road.startsWith(firstPart)) {
          parts.push(firstPart);
        }
        if (road) parts.push(road);
        
        const city = data.address.city || data.address.town || data.address.village || data.address.suburb;
        let state = data.address.state;
        if (state && STATE_ABBREVIATIONS[state]) {
          state = STATE_ABBREVIATIONS[state];
        }
        const postcode = data.address.postcode;
        
        parts.push(city, state, postcode);
        const validParts = parts.filter(Boolean).map(s => String(s).trim());
        cleanAddress = Array.from(new Set(validParts)).join(', ');
      }
      return res.json({ address: cleanAddress });
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

    let address = data.results?.[0]?.formatted_address || null;
    if (address) {
      address = address.replace(/,\s*(USA|United States|United States of America)$/i, '');
    }
    return res.json({ address });
  } catch (err: any) {
    console.error('[Places API] Google reverse geocode failed:', err);
    return res.status(502).json({ error: 'Reverse geocode failed' });
  }
});

export default router;

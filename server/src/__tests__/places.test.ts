import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { setDbName, closeDb, getDb } from '../db';
import { clearPlacesCacheForTests } from '../routes/places';
import * as fs from 'fs';
import * as path from 'path';

const testDbName = '../test-database-places.sqlite';

describe('Places API Proxy Endpoints', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    setDbName(testDbName);
    await getDb();
  });

  afterAll(async () => {
    await closeDb();
    const dbPath = path.join(__dirname, '..', testDbName);
    for (const ext of ['', '-wal', '-shm']) {
      const p = `${dbPath}${ext}`;
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  });

  const mockUser = {
    id: 'test-user-id-places',
    email: 'places@example.com',
    name: 'Places User',
    picture: ''
  };

  const authHeader = { 'x-mock-user': JSON.stringify(mockUser) };

  beforeEach(() => {
    vi.restoreAllMocks();
    clearPlacesCacheForTests();
  });

  it('should return 401 if unauthorized', async () => {
    const res = await request(app).get('/api/places/search?q=test');
    expect(res.status).toBe(401);
  });

  it('should fallback to Nominatim when API key is missing', async () => {
    const originalKey = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    try {
      const mockNominatimResults = [
        {
          place_id: 12345,
          display_name: 'Mock In-Bounds Place, Country',
          lat: '5.5',
          lon: '0.0'
        },
        {
          place_id: 99999,
          display_name: 'Mock Out-Of-Bounds Place, Country',
          lat: '50.0',
          lon: '50.0'
        }
      ];

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        expect(url.toString()).toContain('nominatim.openstreetmap.org');
        return {
          json: async () => mockNominatimResults
        } as Response;
      });

      const res = await request(app)
        .get('/api/places/search?q=coffee&bounds=-1,5,1,6')
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalled();
      expect(res.body).toEqual([
        {
          place_id: 12345,
          title: '',
          address: 'Mock In-Bounds Place, Country',
          lat: '5.5',
          lon: '0.0',
          type: 'global'
        }
      ]);
    } finally {
      process.env.GOOGLE_MAPS_API_KEY = originalKey;
    }
  });

  it('should use Google Places API (New) when API key is present and preserve best match order', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key-value';

    const mockGoogleResults = {
      places: [
        {
          id: 'google-place-id-1',
          displayName: { text: 'Best Match Starbucks', languageCode: 'en' },
          formattedAddress: '999 Best Match Lane',
          location: {
            latitude: 6.0,
            longitude: 1.0
          }
        },
        {
          id: 'google-place-id-2',
          displayName: { text: 'Second Match Starbucks', languageCode: 'en' },
          formattedAddress: '123 Second Match Lane',
          location: {
            latitude: 5.5,
            longitude: 0.0
          }
        },
        {
          id: 'google-place-id-far',
          displayName: { text: 'Far Away Starbucks', languageCode: 'en' },
          formattedAddress: '999 Far Away Lane',
          location: {
            latitude: 44.5,
            longitude: -80.2
          }
        }
      ]
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      expect(url.toString()).toBe('https://places.googleapis.com/v1/places:searchText');
      expect(options?.method).toBe('POST');
      const headers = options?.headers as Record<string, string>;
      expect(headers['X-Goog-Api-Key']).toBe('mock-google-key-value');
      expect(headers['X-Goog-FieldMask']).toContain('places.id');
      const body = JSON.parse(options?.body as string);
      expect(body.textQuery).toBe('starbucks');
      expect(body.locationRestriction.rectangle.low.latitude).toBeCloseTo(5.0);
      expect(body.locationRestriction.rectangle.low.longitude).toBeCloseTo(-1.0);
      expect(body.locationRestriction.rectangle.high.latitude).toBeCloseTo(6.0);
      expect(body.locationRestriction.rectangle.high.longitude).toBeCloseTo(1.0);
      return {
        json: async () => mockGoogleResults
      } as Response;
    });

    const res = await request(app)
      .get('/api/places/search?q=starbucks&bounds=-1,5,1,6')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    // Preserves best match order while filtering out the out-of-bounds result
    expect(res.body).toEqual([
      {
        place_id: 'google-place-id-1',
        lat: '6',
        lon: '1',
        title: 'Best Match Starbucks',
        address: '999 Best Match Lane',
        type: 'global'
      },
      {
        place_id: 'google-place-id-2',
        lat: '5.5',
        lon: '0',
        title: 'Second Match Starbucks',
        address: '123 Second Match Lane',
        type: 'global'
      }
    ]);

    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('should not restrict search when bounds cover the whole world', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key-value';

    const mockGoogleResults = {
      places: [
        {
          id: 'tokyo-id',
          displayName: { text: 'Tokyo Tower', languageCode: 'en' },
          formattedAddress: 'Tokyo, Japan',
          location: { latitude: 35.6586, longitude: 139.7454 }
        },
        {
          id: 'paris-id',
          displayName: { text: 'Eiffel Tower', languageCode: 'en' },
          formattedAddress: 'Paris, France',
          location: { latitude: 48.8584, longitude: 2.2945 }
        }
      ]
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const body = JSON.parse(options?.body as string);
      expect(body.textQuery).toBe('tower');
      // Must not restrict or bias to tiny box
      expect(body.locationRestriction).toBeUndefined();
      expect(body.locationBias).toBeUndefined();
      return {
        json: async () => mockGoogleResults
      } as Response;
    });

    const res = await request(app)
      .get('/api/places/search?q=tower&bounds=-180,85,180,-85')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    expect(res.body.length).toBe(2);
    expect(res.body[0].title).toBe('Tokyo Tower');
    expect(res.body[1].title).toBe('Eiffel Tower');

    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('should reverse geocode via Nominatim when API key is missing', async () => {
    const originalKey = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    try {
      const mockNominatimReverse = {
        display_name: 'Reverse Nominatim Address'
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        expect(url.toString()).toContain('nominatim.openstreetmap.org/reverse');
        return {
          json: async () => mockNominatimReverse
        } as Response;
      });

      const res = await request(app)
        .get('/api/places/reverse-geocode?lat=12.34&lng=56.78')
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.address).toBe('Reverse Nominatim Address');
    } finally {
      process.env.GOOGLE_MAPS_API_KEY = originalKey;
    }
  });

  it('should reverse geocode via Google Geocoding API when API key is present', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key-value';

    const mockGoogleGeocode = {
      status: 'OK',
      results: [
        {
          formatted_address: 'Google Geocoded Address'
        }
      ]
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      expect(url.toString()).toContain('googleapis.com/maps/api/geocode');
      return {
        json: async () => mockGoogleGeocode
      } as Response;
    });

    const res = await request(app)
      .get('/api/places/reverse-geocode?lat=12.34&lng=56.78')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.address).toBe('Google Geocoded Address');

    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('should serve repeated search requests from the in-memory cache without additional fetch calls', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key-value';

    const mockGoogleResults = {
      places: [
        {
          id: 'place-cached-1',
          displayName: { text: 'Cached Place', languageCode: 'en' },
          formattedAddress: '100 Cached St',
          location: { latitude: 10.0, longitude: 20.0 }
        }
      ]
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        json: async () => mockGoogleResults
      } as Response;
    });

    const res1 = await request(app)
      .get('/api/places/search?q=cached-place&bounds=10,20,30,40')
      .set(authHeader);
    expect(res1.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second request with same query and bounds should hit cache
    const res2 = await request(app)
      .get('/api/places/search?q=cached-place&bounds=10,20,30,40')
      .set(authHeader);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual(res1.body);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // No new network call

    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('should serve repeated reverse geocode requests from the in-memory cache', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key-value';

    const mockGoogleGeocode = {
      status: 'OK',
      results: [{ formatted_address: 'Cached Address 123' }]
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        json: async () => mockGoogleGeocode
      } as Response;
    });

    const res1 = await request(app)
      .get('/api/places/reverse-geocode?lat=40.7128&lng=-74.0060')
      .set(authHeader);
    expect(res1.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second request for identical / close coordinates should hit cache
    const res2 = await request(app)
      .get('/api/places/reverse-geocode?lat=40.7128&lng=-74.0060')
      .set(authHeader);
    expect(res2.status).toBe(200);
    expect(res2.body.address).toBe('Cached Address 123');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    delete process.env.GOOGLE_MAPS_API_KEY;
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { getDb, setDbName, closeDb } from '../db';
import * as fs from 'fs';
import * as path from 'path';

const testDbName = '../test-database-places.sqlite';

describe('Places API Proxy Endpoints', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    setDbName(testDbName);
  });

  afterAll(async () => {
    await closeDb();
    const dbPath = path.join(__dirname, '..', testDbName);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
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
  });

  it('should return 401 if unauthorized', async () => {
    const res = await request(app).get('/api/places/search?q=test');
    expect(res.status).toBe(401);
  });

  it('should fallback to Nominatim when API key is missing', async () => {
    const originalKey = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    const mockNominatimResults = [
      {
        place_id: 12345,
        display_name: 'Mock Nominatim Place, Country',
        lat: '12.34',
        lon: '56.78'
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
        display_name: 'Mock Nominatim Place, Country',
        lat: '12.34',
        lon: '56.78',
        type: 'global'
      }
    ]);

    process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  it('should use Google Places API (New) when API key is present', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key-value';

    const mockGoogleResults = {
      places: [
        {
          id: 'google-place-id-1',
          displayName: { text: 'Google Starbucks', languageCode: 'en' },
          formattedAddress: '123 Coffee Lane',
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
      expect(body.locationBias.circle.center.latitude).toBeCloseTo(5.5);
      expect(body.locationBias.circle.center.longitude).toBeCloseTo(0);
      return {
        json: async () => mockGoogleResults
      } as Response;
    });

    const res = await request(app)
      .get('/api/places/search?q=starbucks&bounds=-1,5,1,6')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    expect(res.body).toEqual([
      {
        place_id: 'google-place-id-1',
        display_name: 'Google Starbucks, 123 Coffee Lane',
        lat: '44.5',
        lon: '-80.2',
        type: 'global'
      }
    ]);

    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('should reverse geocode via Nominatim when API key is missing', async () => {
    const originalKey = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    const mockNominatimReverse = {
      display_name: 'Reverse Nominatim Address'
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
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

    process.env.GOOGLE_MAPS_API_KEY = originalKey;
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

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
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
});

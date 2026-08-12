"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const index_1 = require("../index");
const db_1 = require("../db");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const testDbName = '../test-database-places.sqlite';
(0, vitest_1.describe)('Places API Proxy Endpoints', () => {
    (0, vitest_1.beforeAll)(async () => {
        process.env.NODE_ENV = 'test';
        (0, db_1.setDbName)(testDbName);
    });
    (0, vitest_1.afterAll)(async () => {
        await (0, db_1.closeDb)();
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
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.it)('should return 401 if unauthorized', async () => {
        const res = await (0, supertest_1.default)(index_1.app).get('/api/places/search?q=test');
        (0, vitest_1.expect)(res.status).toBe(401);
    });
    (0, vitest_1.it)('should fallback to Nominatim when API key is missing', async () => {
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
        const fetchSpy = vitest_1.vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            (0, vitest_1.expect)(url.toString()).toContain('nominatim.openstreetmap.org');
            return {
                json: async () => mockNominatimResults
            };
        });
        const res = await (0, supertest_1.default)(index_1.app)
            .get('/api/places/search?q=coffee&bounds=-1,5,1,6')
            .set(authHeader);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(fetchSpy).toHaveBeenCalled();
        (0, vitest_1.expect)(res.body).toEqual([
            {
                place_id: 12345,
                title: '',
                address: 'Mock Nominatim Place, Country',
                lat: '12.34',
                lon: '56.78',
                type: 'global'
            }
        ]);
        process.env.GOOGLE_MAPS_API_KEY = originalKey;
    });
    (0, vitest_1.it)('should use Google Places API (New) when API key is present', async () => {
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
        const fetchSpy = vitest_1.vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
            (0, vitest_1.expect)(url.toString()).toBe('https://places.googleapis.com/v1/places:searchText');
            (0, vitest_1.expect)(options?.method).toBe('POST');
            const headers = options?.headers;
            (0, vitest_1.expect)(headers['X-Goog-Api-Key']).toBe('mock-google-key-value');
            (0, vitest_1.expect)(headers['X-Goog-FieldMask']).toContain('places.id');
            const body = JSON.parse(options?.body);
            (0, vitest_1.expect)(body.textQuery).toBe('starbucks');
            (0, vitest_1.expect)(body.locationBias.circle.center.latitude).toBeCloseTo(5.5);
            (0, vitest_1.expect)(body.locationBias.circle.center.longitude).toBeCloseTo(0);
            return {
                json: async () => mockGoogleResults
            };
        });
        const res = await (0, supertest_1.default)(index_1.app)
            .get('/api/places/search?q=starbucks&bounds=-1,5,1,6')
            .set(authHeader);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(fetchSpy).toHaveBeenCalled();
        (0, vitest_1.expect)(res.body).toEqual([
            {
                place_id: 'google-place-id-1',
                lat: '44.5',
                lon: '-80.2',
                title: 'Google Starbucks',
                address: '123 Coffee Lane',
                type: 'global'
            }
        ]);
        delete process.env.GOOGLE_MAPS_API_KEY;
    });
    (0, vitest_1.it)('should reverse geocode via Nominatim when API key is missing', async () => {
        const originalKey = process.env.GOOGLE_MAPS_API_KEY;
        delete process.env.GOOGLE_MAPS_API_KEY;
        const mockNominatimReverse = {
            display_name: 'Reverse Nominatim Address'
        };
        const fetchSpy = vitest_1.vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            (0, vitest_1.expect)(url.toString()).toContain('nominatim.openstreetmap.org/reverse');
            return {
                json: async () => mockNominatimReverse
            };
        });
        const res = await (0, supertest_1.default)(index_1.app)
            .get('/api/places/reverse-geocode?lat=12.34&lng=56.78')
            .set(authHeader);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.address).toBe('Reverse Nominatim Address');
        process.env.GOOGLE_MAPS_API_KEY = originalKey;
    });
    (0, vitest_1.it)('should reverse geocode via Google Geocoding API when API key is present', async () => {
        process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key-value';
        const mockGoogleGeocode = {
            status: 'OK',
            results: [
                {
                    formatted_address: 'Google Geocoded Address'
                }
            ]
        };
        const fetchSpy = vitest_1.vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            (0, vitest_1.expect)(url.toString()).toContain('googleapis.com/maps/api/geocode');
            return {
                json: async () => mockGoogleGeocode
            };
        });
        const res = await (0, supertest_1.default)(index_1.app)
            .get('/api/places/reverse-geocode?lat=12.34&lng=56.78')
            .set(authHeader);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.address).toBe('Google Geocoded Address');
        delete process.env.GOOGLE_MAPS_API_KEY;
    });
});

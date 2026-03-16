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
const testDbName = '../test-database.sqlite';
(0, vitest_1.describe)('API Endpoints', () => {
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
    (0, vitest_1.beforeEach)(async () => {
        const db = await (0, db_1.getDb)();
        await db.exec('DELETE FROM pins');
        await db.exec('DELETE FROM maps');
    });
    (0, vitest_1.it)('GET /api/hello should return hello message', async () => {
        const res = await (0, supertest_1.default)(index_1.app).get('/api/hello');
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.message).toBe('Hello from Our Maps Server!');
    });
    (0, vitest_1.it)('POST /api/maps should create a new map', async () => {
        const mapId = 'test-map-id';
        const mapData = {
            id: mapId,
            name: 'Test Map',
            pins: [
                { id: 'pin-1', lat: 10, lng: 20, label: 'Pin 1', description: 'Desc 1', imageUrl: 'http://img.com/1', color: 'red', icon: 'hotel' }
            ]
        };
        const res = await (0, supertest_1.default)(index_1.app)
            .post('/api/maps')
            .send(mapData);
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.id).toBe(mapId);
        const db = await (0, db_1.getDb)();
        const map = await db.get('SELECT * FROM maps WHERE id = ?', mapId);
        (0, vitest_1.expect)(map.name).toBe('Test Map');
        const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
        (0, vitest_1.expect)(pins).toHaveLength(1);
        (0, vitest_1.expect)(pins[0].label).toBe('Pin 1');
        (0, vitest_1.expect)(pins[0].description).toBe('Desc 1');
        (0, vitest_1.expect)(pins[0].image_url).toBe('http://img.com/1');
        (0, vitest_1.expect)(pins[0].color).toBe('red');
        (0, vitest_1.expect)(pins[0].icon).toBe('hotel');
    });
    (0, vitest_1.it)('POST /api/maps should return 400 if map id is missing', async () => {
        const mapData = { name: 'Invalid Map' };
        const res = await (0, supertest_1.default)(index_1.app).post('/api/maps').send(mapData);
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    (0, vitest_1.it)('GET /api/maps/:id should return 404 for non-existent map', async () => {
        const res = await (0, supertest_1.default)(index_1.app).get('/api/maps/does-not-exist');
        (0, vitest_1.expect)(res.status).toBe(404);
        (0, vitest_1.expect)(res.body.error).toBe('Map not found');
    });
    (0, vitest_1.it)('GET /api/maps/:id should return map data', async () => {
        const mapId = 'test-map-id';
        const db = await (0, db_1.getDb)();
        await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', mapId, 'Loaded Map');
        await db.run('INSERT INTO pins (id, map_id, lat, lng, label) VALUES (?, ?, ?, ?, ?)', 'p1', mapId, 5, 5, 'L1');
        const res = await (0, supertest_1.default)(index_1.app).get(`/api/maps/${mapId}`);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.name).toBe('Loaded Map');
        (0, vitest_1.expect)(res.body.pins).toHaveLength(1);
    });
    (0, vitest_1.it)('PUT /api/maps/:id should update map name and pins', async () => {
        const mapId = 'update-map-id';
        const db = await (0, db_1.getDb)();
        await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', mapId, 'Old Name');
        const updateData = {
            name: 'New Name',
            pins: [
                { id: 'new-pin', lat: 50, lng: 60, label: 'New Pin', description: 'New Desc', imageUrl: 'http://new.com', color: 'green', icon: 'airport' }
            ]
        };
        const res = await (0, supertest_1.default)(index_1.app)
            .put(`/api/maps/${mapId}`)
            .send(updateData);
        (0, vitest_1.expect)(res.status).toBe(200);
        const map = await db.get('SELECT * FROM maps WHERE id = ?', mapId);
        (0, vitest_1.expect)(map.name).toBe('New Name');
        const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
        (0, vitest_1.expect)(pins).toHaveLength(1);
        (0, vitest_1.expect)(pins[0].id).toBe('new-pin');
        (0, vitest_1.expect)(pins[0].description).toBe('New Desc');
        (0, vitest_1.expect)(pins[0].color).toBe('green');
        (0, vitest_1.expect)(pins[0].icon).toBe('airport');
    });
});

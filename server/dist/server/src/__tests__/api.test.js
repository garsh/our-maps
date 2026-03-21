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
    const mockUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        picture: ''
    };
    const authHeader = { 'x-mock-user': JSON.stringify(mockUser) };
    (0, vitest_1.beforeEach)(async () => {
        const db = await (0, db_1.getDb)();
        await db.exec('DELETE FROM user_map_access');
        await db.exec('DELETE FROM map_permissions');
        await db.exec('DELETE FROM pins');
        await db.exec('DELETE FROM maps');
        await db.exec('DELETE FROM users');
        // Ensure test user exists for FK constraints
        await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', mockUser.id, mockUser.email, mockUser.name);
    });
    (0, vitest_1.it)('GET /api/hello should return hello message', async () => {
        // Hello doesn't need auth, but middleware is applied globally now? No, usually selective.
        // Wait, I applied it to all /api/maps routes. /api/hello is separate.
        const res = await (0, supertest_1.default)(index_1.app).get('/api/hello');
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.message).toBe('Hello from Our Maps Server!');
    });
    (0, vitest_1.it)('POST /api/maps should create a new map', async () => {
        const mapId = 'test-map-id';
        const mapData = {
            id: mapId,
            name: 'Test Map',
            groups: [
                { id: 'group-1', name: 'My Group', position: 0 }
            ],
            pins: [
                { id: 'pin-1', map_id: mapId, groupId: 'group-1', lat: 10, lng: 20, label: 'Pin 1', description: 'Desc 1', imageUrl: 'http://img.com/1', color: 'red', icon: 'hotel', position: 0 }
            ]
        };
        const res = await (0, supertest_1.default)(index_1.app)
            .post('/api/maps')
            .set(authHeader)
            .send(mapData);
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.id).toBe(mapId);
        (0, vitest_1.expect)(res.body.ownerId).toBe(mockUser.id);
        const db = await (0, db_1.getDb)();
        const map = await db.get('SELECT * FROM maps WHERE id = ?', mapId);
        (0, vitest_1.expect)(map.name).toBe('Test Map');
        (0, vitest_1.expect)(map.owner_id).toBe(mockUser.id);
        const groups = await db.all('SELECT * FROM pin_groups WHERE map_id = ?', mapId);
        (0, vitest_1.expect)(groups).toHaveLength(1);
        (0, vitest_1.expect)(groups[0].name).toBe('My Group');
        const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
        (0, vitest_1.expect)(pins).toHaveLength(1);
        (0, vitest_1.expect)(pins[0].group_id).toBe('group-1');
        (0, vitest_1.expect)(pins[0].position).toBe(0);
    });
    (0, vitest_1.it)('POST /api/maps should return 400 if map id is missing', async () => {
        const mapData = { name: 'Invalid Map' };
        const res = await (0, supertest_1.default)(index_1.app).post('/api/maps').set(authHeader).send(mapData);
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    (0, vitest_1.it)('GET /api/maps/:id should return 404 for non-existent map', async () => {
        const res = await (0, supertest_1.default)(index_1.app).get('/api/maps/does-not-exist').set(authHeader);
        (0, vitest_1.expect)(res.status).toBe(404);
        (0, vitest_1.expect)(res.body.error).toBe('Map not found');
    });
    (0, vitest_1.it)('GET /api/maps/:id should return map data', async () => {
        const mapId = 'test-map-id';
        const db = await (0, db_1.getDb)();
        await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', mapId, 'Loaded Map', mockUser.id);
        await db.run('INSERT INTO pins (id, map_id, lat, lng, label) VALUES (?, ?, ?, ?, ?)', 'p1', mapId, 5, 5, 'L1');
        const res = await (0, supertest_1.default)(index_1.app).get(`/api/maps/${mapId}`).set(authHeader);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.name).toBe('Loaded Map');
        (0, vitest_1.expect)(res.body.pins).toHaveLength(1);
        (0, vitest_1.expect)(res.body.userRole).toBe('owner');
    });
    (0, vitest_1.it)('PUT /api/maps/:id should update map name and pins', async () => {
        const mapId = 'update-map-id';
        const db = await (0, db_1.getDb)();
        await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', mapId, 'Old Name', mockUser.id);
        const updateData = {
            name: 'New Name',
            groups: [
                { id: 'g1', name: 'G1', position: 0 }
            ],
            pins: [
                { id: 'new-pin', map_id: mapId, groupId: 'g1', lat: 50, lng: 60, label: 'New Pin', description: 'New Desc', imageUrl: 'http://new.com', color: 'green', icon: 'airport', position: 0 }
            ]
        };
        const res = await (0, supertest_1.default)(index_1.app)
            .put(`/api/maps/${mapId}`)
            .set(authHeader)
            .send(updateData);
        (0, vitest_1.expect)(res.status).toBe(200);
        const map = await db.get('SELECT * FROM maps WHERE id = ?', mapId);
        (0, vitest_1.expect)(map.name).toBe('New Name');
        const groups = await db.all('SELECT * FROM pin_groups WHERE map_id = ?', mapId);
        (0, vitest_1.expect)(groups).toHaveLength(1);
        (0, vitest_1.expect)(groups[0].name).toBe('G1');
        const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
        (0, vitest_1.expect)(pins).toHaveLength(1);
        (0, vitest_1.expect)(pins[0].id).toBe('new-pin');
        (0, vitest_1.expect)(pins[0].group_id).toBe('g1');
    });
});

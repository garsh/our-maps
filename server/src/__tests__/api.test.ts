import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../index';
import { getDb, setDbName, closeDb } from '../db';
import * as fs from 'fs';
import * as path from 'path';

const testDbName = '../test-database.sqlite';

describe('API Endpoints', () => {
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
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    picture: ''
  };

  const authHeader = { 'x-mock-user': JSON.stringify(mockUser) };

  beforeEach(async () => {
    const db = await getDb();
    await db.exec('DELETE FROM user_map_access');
    await db.exec('DELETE FROM map_permissions');
    await db.exec('DELETE FROM pins');
    await db.exec('DELETE FROM maps');
    await db.exec('DELETE FROM users');
    // Ensure test user exists for FK constraints
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', mockUser.id, mockUser.email, mockUser.name);
  });

  it('GET /api/hello should return hello message', async () => {
    // Hello doesn't need auth, but middleware is applied globally now? No, usually selective.
    // Wait, I applied it to all /api/maps routes. /api/hello is separate.
    const res = await request(app).get('/api/hello');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Hello from Our Maps Server!');
  });

  it('POST /api/maps should create a new map', async () => {
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

    const res = await request(app)
      .post('/api/maps')
      .set(authHeader)
      .send(mapData);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(mapId);
    expect(res.body.ownerId).toBe(mockUser.id);

    const db = await getDb();
    const map = await db.get('SELECT * FROM maps WHERE id = ?', mapId);
    expect(map.name).toBe('Test Map');
    expect(map.owner_id).toBe(mockUser.id);

    const groups = await db.all('SELECT * FROM pin_groups WHERE map_id = ?', mapId);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('My Group');

    const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
    expect(pins).toHaveLength(1);
    expect(pins[0].group_id).toBe('group-1');
    expect(pins[0].position).toBe(0);
  });

  it('POST /api/maps should return 400 if map id is missing', async () => {
    const mapData = { name: 'Invalid Map' };
    const res = await request(app).post('/api/maps').set(authHeader).send(mapData);
    expect(res.status).toBe(400);
  });

  it('GET /api/maps/:id should return 404 for non-existent map', async () => {
    const res = await request(app).get('/api/maps/does-not-exist').set(authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Map not found');
  });

  it('POST /api/maps should create a new map with groups and pins', async () => {
    const mapId = 'create-map-with-groups-id';
    const postData = {
      id: mapId,
      name: 'Map with Groups',
      groups: [
        { id: 'group-uuid-1', name: 'Group 1', position: 0 }
      ],
      pins: [
        { id: 'pin-uuid-1', groupId: 'group-uuid-1', lat: 10, lng: 20, label: 'Pin 1', position: 0 }
      ]
    };

    const res = await request(app)
      .post('/api/maps')
      .set(authHeader)
      .send(postData);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(mapId);

    const db = await getDb();
    const groups = await db.all('SELECT * FROM pin_groups WHERE map_id = ?', mapId);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('group-uuid-1');
  });

  it('GET /api/maps/:id should return map data', async () => {
    const mapId = 'test-map-id';
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', mapId, 'Loaded Map', mockUser.id);
    await db.run('INSERT INTO pins (id, map_id, lat, lng, label) VALUES (?, ?, ?, ?, ?)', 
      'p1', mapId, 5, 5, 'L1');

    const res = await request(app).get(`/api/maps/${mapId}`).set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Loaded Map');
    expect(res.body.pins).toHaveLength(1);
    expect(res.body.userRole).toBe('owner');
  });

  it('PUT /api/maps/:id should update map name and pins', async () => {
    const mapId = 'update-map-id';
    const db = await getDb();
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

    const res = await request(app)
      .put(`/api/maps/${mapId}`)
      .set(authHeader)
      .send(updateData);

    expect(res.status).toBe(200);

    const map = await db.get('SELECT * FROM maps WHERE id = ?', mapId);
    expect(map.name).toBe('New Name');

    const groups = await db.all('SELECT * FROM pin_groups WHERE map_id = ?', mapId);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('G1');

    const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
    expect(pins).toHaveLength(1);
    expect(pins[0].id).toBe('new-pin');
    expect(pins[0].group_id).toBe('g1');
  });

  it('POST /api/auth/google-login should return 400 if credential is missing', async () => {
    const res = await request(app).post('/api/auth/google-login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Credential is required');
  });

  it('Custom JWT should authorize request successfully', async () => {
    const JWT_SECRET = process.env.JWT_SECRET || 'our-maps-dev-secret-key-30-days';
    const testUserToken = jwt.sign(
      {
        sub: 'jwt-test-user-id',
        email: 'jwt-test@example.com',
        name: 'JWT Test User',
        picture: 'http://picture.com'
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Let's create a map to verify it can read/write maps
    const mapId = 'jwt-map-id';
    const mapData = {
      id: mapId,
      name: 'JWT Map',
      groups: [],
      pins: []
    };

    // Make request using Bearer token
    const res = await request(app)
      .post('/api/maps')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(mapData);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(mapId);
    expect(res.body.ownerId).toBe('jwt-test-user-id');
  });
});

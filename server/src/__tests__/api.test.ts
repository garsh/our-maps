import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../index';
import { getDb, setDbName, closeDb, purgeExpiredSessions } from '../db';
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

  it('POST /api/maps should create a new map', async () => {
    const mapId = 'test-map-id';
    const mapData = {
      id: mapId,
      name: 'Test Map',
      layers: [
        { id: 'layer-1', name: 'My Layer', position: 0 }
      ],
      pins: [
        { id: 'pin-1', map_id: mapId, layerId: 'layer-1', lat: 10, lng: 20, label: 'Pin 1', description: 'Desc 1', color: 'red', icon: 'hotel', position: 0 }
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

    const layers = await db.all('SELECT * FROM pin_layers WHERE map_id = ?', mapId);
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe('My Layer');

    const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
    expect(pins).toHaveLength(1);
    expect(pins[0].layer_id).toBe('layer-1');
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

  it('POST /api/maps should create a new map with layers and pins', async () => {
    const mapId = 'create-map-with-layers-id';
    const postData = {
      id: mapId,
      name: 'Map with Groups',
      layers: [
        { id: 'layer-uuid-1', name: 'Layer 1', position: 0 }
      ],
      pins: [
        { id: 'pin-uuid-1', layerId: 'layer-uuid-1', lat: 10, lng: 20, label: 'Pin 1', position: 0 }
      ]
    };

    const res = await request(app)
      .post('/api/maps')
      .set(authHeader)
      .send(postData);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(mapId);

    const db = await getDb();
    const layers = await db.all('SELECT * FROM pin_layers WHERE map_id = ?', mapId);
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('layer-uuid-1');
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
      layers: [
        { id: 'g1', name: 'G1', position: 0 }
      ],
      pins: [
        { id: 'new-pin', map_id: mapId, layerId: 'g1', lat: 50, lng: 60, label: 'New Pin', description: 'New Desc', color: 'green', icon: 'airport', position: 0 }
      ]
    };

    const res = await request(app)
      .put(`/api/maps/${mapId}`)
      .set(authHeader)
      .send(updateData);

    expect(res.status).toBe(200);

    const map = await db.get('SELECT * FROM maps WHERE id = ?', mapId);
    expect(map.name).toBe('New Name');

    const layers = await db.all('SELECT * FROM pin_layers WHERE map_id = ?', mapId);
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe('G1');

    const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
    expect(pins).toHaveLength(1);
    expect(pins[0].id).toBe('new-pin');
    expect(pins[0].layer_id).toBe('g1');
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
      layers: [],
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

  it('GET /api/auth/me returns null user when there is no session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('mock login sets a session cookie and /auth/me returns the user', async () => {
    const loginRes = await request(app).post('/api/auth/mock-login');
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe('mock@example.com');
    expect(loginRes.body.token).toBeUndefined();
    const rawCookie = loginRes.headers['set-cookie'];
    const cookie = Array.isArray(rawCookie) ? rawCookie.join('; ') : rawCookie;
    expect(cookie).toContain('ourmaps_session=');
    expect(cookie).toMatch(/httponly/i);

    const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('mock@example.com');
  });

  it('logout-everywhere invalidates other sessions', async () => {
    const first = await request(app).post('/api/auth/mock-login');
    const second = await request(app).post('/api/auth/mock-login');
    const cookie1 = (Array.isArray(first.headers['set-cookie']) ? first.headers['set-cookie'] : [first.headers['set-cookie']]).join('; ');
    const cookie2 = (Array.isArray(second.headers['set-cookie']) ? second.headers['set-cookie'] : [second.headers['set-cookie']]).join('; ');

    const everywhere = await request(app).post('/api/auth/logout-everywhere').set('Cookie', cookie2);
    expect(everywhere.status).toBe(200);

    const me1 = await request(app).get('/api/auth/me').set('Cookie', cookie1);
    const me2 = await request(app).get('/api/auth/me').set('Cookie', cookie2);
    expect(me1.status).toBe(200);
    expect(me1.body.user).toBeNull();
    expect(me2.status).toBe(200);
    expect(me2.body.user).toBeNull();
  });

  it('purgeExpiredSessions deletes expired rows and keeps live ones', async () => {
    const db = await getDb();
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', 'sess-user', 'sess@example.com', 'Sess');
    await db.run(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
      'expired-session',
      'sess-user',
      '2000-01-01T00:00:00.000Z'
    );
    await db.run(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
      'live-session',
      'sess-user',
      '2099-01-01T00:00:00.000Z'
    );

    await purgeExpiredSessions();

    expect(await db.get('SELECT id FROM sessions WHERE id = ?', 'expired-session')).toBeUndefined();
    expect(await db.get('SELECT id FROM sessions WHERE id = ?', 'live-session')).toBeDefined();
  });

  it('GET /maps/sprites/light@2x.png should return sprite image', async () => {
    // Sprites are gitignored (`npm run setup:sprites`), so worktrees may not have them.
    const spritesDir = path.resolve(__dirname, '../../../data/sprites');
    const spritePath = path.join(spritesDir, 'light@2x.png');
    const createdFixture = !fs.existsSync(spritePath);
    if (createdFixture) {
      const png1x1 = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      fs.mkdirSync(spritesDir, { recursive: true });
      fs.writeFileSync(spritePath, png1x1);
    }
    try {
      const res = await request(app).get('/maps/sprites/light@2x.png');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
    } finally {
      if (createdFixture && fs.existsSync(spritePath)) {
        fs.unlinkSync(spritePath);
      }
    }
  });

  it('POST /api/maps should allow long pin labels and descriptions (> 255 characters)', async () => {
    const mapId = 'long-label-map-id';
    const longLabel = 'Stoos Ridge trail - This hike was absolutely breathtaking! It’s especially enjoyable because it’s only 2.5 miles along a ridge and you get to see 7 lakes along the way\nanother unique thing about Stoos is that you take the steepest funicular in the world to embark on it!\n💲33.59 usd per person';
    const mapData = {
      id: mapId,
      name: 'Italy and Switzerland',
      layers: [{ id: 'layer-1', name: 'Untitled layer', position: 0 }],
      pins: [
        {
          id: 'pin-1',
          layerId: 'layer-1',
          lat: 46.9567923,
          lng: 8.6654823,
          label: longLabel,
          description: 'A very long description that can exceed normal lengths easily',
          position: 0
        }
      ]
    };

    const res = await request(app)
      .post('/api/maps')
      .set(authHeader)
      .send(mapData);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(mapId);
    expect(res.body.pins[0].label).toBe(longLabel);
  });

  it('GET /api/maps/:id/permissions should return owner, permissions, and userRole without pins or layers', async () => {
    const mapId = 'permissions-test-map';
    const mapData = {
      id: mapId,
      name: 'Permissions Map',
      layers: [{ id: 'layer-1', name: 'Layer', position: 0 }],
      pins: [{ id: 'pin-1', layerId: 'layer-1', lat: 10, lng: 20, label: 'Pin 1', position: 0 }]
    };

    // Create map
    await request(app).post('/api/maps').set(authHeader).send(mapData);

    // Create a collaborator
    const db = await getDb();
    const collabId = 'collab-user-id';
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', collabId, 'collab@example.com', 'Collab User');
    await db.run('INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)', mapId, collabId, 'edit');

    const res = await request(app)
      .get(`/api/maps/${mapId}/permissions`)
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.owner.id).toBe(mockUser.id);
    expect(res.body.userRole).toBe('owner');
    expect(res.body.permissions).toHaveLength(1);
    expect(res.body.permissions[0]).toEqual({
      userId: collabId,
      userEmail: 'collab@example.com',
      userName: 'Collab User',
      userPicture: null,
      role: 'edit'
    });
    // Ensure pins and layers are NOT transferred
    expect(res.body.pins).toBeUndefined();
    expect(res.body.layers).toBeUndefined();
  });

  it('GET /api/auth/shared-contacts only returns emails from existing shares', async () => {
    const mapId = 'shared-contacts-map';
    await request(app).post('/api/maps').set(authHeader).send({
      id: mapId,
      name: 'Shared Contacts Map',
      layers: [],
      pins: []
    });

    const db = await getDb();
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', 'collab-shared', 'collab-shared@example.com', 'Collab Shared');
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', 'stranger-user', 'stranger@example.com', 'Stranger');
    await db.run('INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)', mapId, 'collab-shared', 'view');

    const res = await request(app).get('/api/auth/shared-contacts').set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.emails).toContain('collab-shared@example.com');
    expect(res.body.emails).not.toContain('stranger@example.com');
    expect(res.body.emails).not.toContain('test@example.com');
  });

  it('does not grant other users access to mock-user-id maps', async () => {
    const db = await getDb();
    await db.run(
      'INSERT INTO users (id, email, name) VALUES (?, ?, ?)',
      'mock-user-id',
      'mock@example.com',
      'Mock User'
    );
    await db.run(
      'INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)',
      'legacy-mock-map',
      'Legacy Mock Map',
      'mock-user-id'
    );

    const listRes = await request(app).get('/api/maps').set(authHeader);
    expect(listRes.status).toBe(200);
    expect(listRes.body.find((m: any) => m.id === 'legacy-mock-map')).toBeUndefined();

    const getRes = await request(app).get('/api/maps/legacy-mock-map').set(authHeader);
    expect(getRes.status).toBe(403);

    const permRes = await request(app).get('/api/maps/legacy-mock-map/permissions').set(authHeader);
    expect(permRes.status).toBe(403);

    const mockOwnerHeader = {
      'x-mock-user': JSON.stringify({
        id: 'mock-user-id',
        email: 'mock@example.com',
        name: 'Mock User'
      })
    };
    const ownerRes = await request(app).get('/api/maps/legacy-mock-map').set(mockOwnerHeader);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.userRole).toBe('owner');
  });

  it('rejects map file path traversal', async () => {
    const traversalRes = await request(app).get('/maps/..%2F..%2F..%2Fetc/passwd');
    expect(traversalRes.status).toBe(404);
    expect(traversalRes.body.error).toBe('Map file not found');

    const fontTraversalRes = await request(app).get('/maps/fonts/..%2F..%2Fpackage.json');
    expect(fontTraversalRes.status).toBe(404);
  });

  it('POST /api/maps should efficiently batch insert 250 pins across multiple layers', async () => {
    const mapId = 'batch-insert-map-id';
    const layers = Array.from({ length: 5 }, (_, i) => ({
      id: `layer-batch-${i}`,
      name: `Layer ${i}`,
      position: i
    }));
    const pins = Array.from({ length: 250 }, (_, i) => ({
      id: `pin-batch-${i}`,
      map_id: mapId,
      layerId: `layer-batch-${i % 5}`,
      lat: 40 + i * 0.001,
      lng: -74 - i * 0.001,
      label: `Batch Pin ${i}`,
      description: `Description ${i}`,
      address: `Address ${i}`,
      color: 'blue',
      icon: 'default',
      position: i
    }));

    const res = await request(app)
      .post('/api/maps')
      .set(authHeader)
      .send({ id: mapId, name: 'Batch Map', layers, pins });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(mapId);

    const db = await getDb();
    const savedLayers = await db.all('SELECT * FROM pin_layers WHERE map_id = ?', mapId);
    expect(savedLayers).toHaveLength(5);

    const savedPins = await db.all('SELECT * FROM pins WHERE map_id = ?', mapId);
    expect(savedPins).toHaveLength(250);
  });
});

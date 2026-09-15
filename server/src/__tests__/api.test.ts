import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../index';
import { getDb, setDbName, closeDb, purgeExpiredSessions } from '../db';
import * as fs from 'fs';
import * as path from 'path';

describe('API Endpoints', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    setDbName(':memory:');
  });

  afterAll(async () => {
    await closeDb();
  });

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    picture: ''
  };

  const authHeader = { 'x-mock-user': JSON.stringify(mockUser) };

  const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

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
    const mapId = uuid(1);
    const mapData = {
      id: mapId,
      name: 'Test Map',
      layers: [
        { id: uuid(2), name: 'My Layer', position: 0 }
      ],
      pins: [
        { id: uuid(3), map_id: mapId, layerId: uuid(2), lat: 10, lng: 20, label: 'Pin 1', description: 'Desc 1', color: 'red', icon: 'hotel', position: 0 }
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
    expect(pins[0].layer_id).toBe(uuid(2));
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
    const mapId = uuid(10);
    const postData = {
      id: mapId,
      name: 'Map with Groups',
      layers: [
        { id: uuid(11), name: 'Layer 1', position: 0 }
      ],
      pins: [
        { id: uuid(12), layerId: uuid(11), lat: 10, lng: 20, label: 'Pin 1', position: 0 }
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
    expect(layers[0].id).toBe(uuid(11));
  });

  it('GET /api/maps/:id should return map data', async () => {
    const mapId = uuid(20);
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', mapId, 'Loaded Map', mockUser.id);
    await db.run('INSERT INTO pins (id, map_id, lat, lng, label) VALUES (?, ?, ?, ?, ?)', 
      uuid(21), mapId, 5, 5, 'L1');

    const res = await request(app).get(`/api/maps/${mapId}`).set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Loaded Map');
    expect(res.body.pins).toHaveLength(1);
    expect(res.body.userRole).toBe('owner');
  });

  it('GET /api/maps/:id serializes pins and layers without map_id or layer_id', async () => {
    const mapId = uuid(22);
    const layerId = uuid(23);
    const pinId = uuid(24);
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', mapId, 'Shape Map', mockUser.id);
    await db.run(
      'INSERT INTO pin_layers (id, map_id, name, position) VALUES (?, ?, ?, ?)',
      layerId, mapId, 'Layer A', 1
    );
    await db.run(
      'INSERT INTO pins (id, map_id, layer_id, lat, lng, label, description, address, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      pinId, mapId, layerId, 12.5, -8.25, 'Cafe', 'Notes', '1 Main St', 'green', 'restaurant', 2
    );

    const res = await request(app).get(`/api/maps/${mapId}`).set(authHeader);
    expect(res.status).toBe(200);

    expect(res.body.layers).toHaveLength(1);
    expect(res.body.layers[0]).toEqual({ id: layerId, name: 'Layer A', position: 1 });
    expect(res.body.layers[0]).not.toHaveProperty('map_id');

    expect(res.body.pins).toHaveLength(1);
    expect(res.body.pins[0]).toEqual({
      id: pinId,
      lat: 12.5,
      lng: -8.25,
      label: 'Cafe',
      description: 'Notes',
      address: '1 Main St',
      color: 'green',
      icon: 'restaurant',
      position: 2,
      layerId,
    });
    expect(res.body.pins[0]).not.toHaveProperty('map_id');
    expect(res.body.pins[0]).not.toHaveProperty('layer_id');
    expect(res.body).not.toHaveProperty('permissions');
    expect(res.body).not.toHaveProperty('ownerId');
    expect(res.body).not.toHaveProperty('ownerName');
    expect(res.body).not.toHaveProperty('ownerEmail');
    expect(res.body).not.toHaveProperty('ownerPicture');
    expect(res.body.userRole).toBe('owner');
    expect(res.body.isPublic).toBe(false);
  });

  it('PUT /api/maps/:id should update map name and pins', async () => {
    const mapId = uuid(30);
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', mapId, 'Old Name', mockUser.id);

    const updateData = {
      name: 'New Name',
      layers: [
        { id: uuid(31), name: 'G1', position: 0 }
      ],
      pins: [
        { id: uuid(32), map_id: mapId, layerId: uuid(31), lat: 50, lng: 60, label: 'New Pin', description: 'New Desc', color: 'green', icon: 'airport', position: 0 }
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
    expect(pins[0].id).toBe(uuid(32));
    expect(pins[0].layer_id).toBe(uuid(31));
  });

  it('POST, GET, and PUT /api/maps should handle customColors per map', async () => {
    const mapId = uuid(40);
    const postData = {
      id: mapId,
      name: 'Custom Colors Map',
      customColors: ['#ffc800', '#c8ff00'],
      layers: [],
      pins: []
    };

    const createRes = await request(app)
      .post('/api/maps')
      .set(authHeader)
      .send(postData);

    expect(createRes.status).toBe(201);
    expect(createRes.body.customColors).toEqual(['#ffc800', '#c8ff00']);

    const getRes = await request(app)
      .get(`/api/maps/${mapId}`)
      .set(authHeader);

    expect(getRes.status).toBe(200);
    expect(getRes.body.customColors).toEqual(['#ffc800', '#c8ff00']);

    const updateRes = await request(app)
      .put(`/api/maps/${mapId}`)
      .set(authHeader)
      .send({
        customColors: ['#ffc800', '#c8ff00', '#00ffc8']
      });

    expect(updateRes.status).toBe(200);

    const getRes2 = await request(app)
      .get(`/api/maps/${mapId}`)
      .set(authHeader);

    expect(getRes2.status).toBe(200);
    expect(getRes2.body.customColors).toEqual(['#ffc800', '#c8ff00', '#00ffc8']);
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
    const mapId = uuid(50);
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
    const mapId = uuid(60);
    const longLabel = 'Stoos Ridge trail - This hike was absolutely breathtaking! It’s especially enjoyable because it’s only 2.5 miles along a ridge and you get to see 7 lakes along the way\nanother unique thing about Stoos is that you take the steepest funicular in the world to embark on it!\n💲33.59 usd per person';
    const mapData = {
      id: mapId,
      name: 'Italy and Switzerland',
      layers: [{ id: uuid(61), name: 'Untitled layer', position: 0 }],
      pins: [
        {
          id: uuid(62),
          layerId: uuid(61),
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
    const mapId = uuid(70);
    const mapData = {
      id: mapId,
      name: 'Permissions Map',
      layers: [{ id: uuid(71), name: 'Layer', position: 0 }],
      pins: [{ id: uuid(72), layerId: uuid(71), lat: 10, lng: 20, label: 'Pin 1', position: 0 }]
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
    const mapId = uuid(80);
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

  it('POST /api/auth/filter-contacts filters candidate emails against all registered users', async () => {
    const db = await getDb();
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', 'collab-shared', 'collab-shared@example.com', 'Collab Shared');
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', 'stranger-user', 'stranger@example.com', 'Stranger');

    const res = await request(app)
      .post('/api/auth/filter-contacts')
      .set(authHeader)
      .send({
        emails: [
          'COLLAB-SHARED@EXAMPLE.COM',
          'stranger@example.com',
          'unregistered@example.com',
          'test@example.com'
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.existingEmails).toContain('collab-shared@example.com');
    expect(res.body.existingEmails).toContain('stranger@example.com');
    expect(res.body.existingEmails).not.toContain('unregistered@example.com');
    expect(res.body.existingEmails).not.toContain('test@example.com');
  });

  it('POST /api/auth/filter-contacts handles validation and empty input', async () => {
    const badRes = await request(app)
      .post('/api/auth/filter-contacts')
      .set(authHeader)
      .send({ emails: 'not-an-array' });
    expect(badRes.status).toBe(400);

    const emptyRes = await request(app)
      .post('/api/auth/filter-contacts')
      .set(authHeader)
      .send({ emails: [] });
    expect(emptyRes.status).toBe(200);
    expect(emptyRes.body.existingEmails).toEqual([]);
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

  it('GET .pmtiles requires a Range header and serves a bounded range', async () => {
    const mapsDir = path.resolve(__dirname, '../../../data/maps');
    const filePath = path.join(mapsDir, 'range-cap-test.pmtiles');
    fs.mkdirSync(mapsDir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(64 * 1024, 7));
    try {
      const noRange = await request(app).get('/maps/range-cap-test.pmtiles');
      expect(noRange.status).toBe(400);

      const ranged = await request(app)
        .get('/maps/range-cap-test.pmtiles')
        .set('Range', 'bytes=0-15');
      expect(ranged.status).toBe(206);
      expect(ranged.headers['content-length']).toBe('16');
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  it('rejects map file path traversal', async () => {
    const traversalRes = await request(app).get('/maps/..%2F..%2F..%2Fetc/passwd');
    expect(traversalRes.status).toBe(404);
    expect(traversalRes.body.error).toBe('Map file not found');

    const fontTraversalRes = await request(app).get('/maps/fonts/..%2F..%2Fpackage.json');
    expect(fontTraversalRes.status).toBe(404);
  });

  it('POST /api/maps should efficiently batch insert 250 pins across multiple layers', async () => {
    const mapId = uuid(90);
    const layers = Array.from({ length: 5 }, (_, i) => ({
      id: uuid(200 + i),
      name: `Layer ${i}`,
      position: i
    }));
    const pins = Array.from({ length: 250 }, (_, i) => ({
      id: uuid(300 + i),
      map_id: mapId,
      layerId: uuid(200 + (i % 5)),
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

  it('handles public link sharing and anonymous access correctly', async () => {
    const mapId = uuid(100);
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name, owner_id, is_public) VALUES (?, ?, ?, 0)', mapId, 'Secret Map', mockUser.id);
    await db.run('INSERT INTO pins (id, map_id, lat, lng, label) VALUES (?, ?, 10, 20, ?)', 'pin-p1', mapId, 'Public Pin');

    // 1. Unauthenticated request to private map -> 401
    const privateRes = await request(app).get(`/api/maps/${mapId}`);
    expect(privateRes.status).toBe(401);

    // 2. Owner enables public link sharing via PUT /api/maps/:id/public
    const toggleRes = await request(app)
      .put(`/api/maps/${mapId}/public`)
      .set(authHeader)
      .send({ isPublic: true });
    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.isPublic).toBe(true);

    // 3. Unauthenticated request to public map -> 200, role 'view', isPublic true, no owner/collaborator payload
    const publicRes = await request(app).get(`/api/maps/${mapId}`);
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.userRole).toBe('view');
    expect(publicRes.body.isPublic).toBe(true);
    expect(publicRes.body.pins).toHaveLength(1);
    expect(publicRes.body).not.toHaveProperty('ownerName');
    expect(publicRes.body).not.toHaveProperty('ownerEmail');
    expect(publicRes.body).not.toHaveProperty('ownerPicture');
    expect(publicRes.body).not.toHaveProperty('ownerId');
    expect(publicRes.body).not.toHaveProperty('permissions');
    expect(publicRes.body).not.toHaveProperty('owner_email');
    expect(publicRes.body).not.toHaveProperty('owner_id');
    expect(publicRes.body).not.toHaveProperty('owner_name');
    expect(publicRes.body).not.toHaveProperty('owner_picture');

    const publicPerms = await request(app).get(`/api/maps/${mapId}/permissions`);
    expect(publicPerms.status).toBe(200);
    expect(publicPerms.body.owner).toBeNull();
    expect(publicPerms.body.permissions).toEqual([]);
    expect(publicPerms.body.userRole).toBe('view');

    // 4. Non-owner cannot toggle public sharing
    const strangerUser = { id: 'stranger-id', email: 'stranger@example.com', name: 'Stranger' };
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', strangerUser.id, strangerUser.email, strangerUser.name);
    const forbiddenRes = await request(app)
      .put(`/api/maps/${mapId}/public`)
      .set({ 'x-mock-user': JSON.stringify(strangerUser) })
      .send({ isPublic: false });
    expect(forbiddenRes.status).toBe(403);

    const strangerGet = await request(app)
      .get(`/api/maps/${mapId}`)
      .set({ 'x-mock-user': JSON.stringify(strangerUser) });
    expect(strangerGet.status).toBe(200);
    expect(strangerGet.body.userRole).toBe('view');
    expect(strangerGet.body).not.toHaveProperty('permissions');
    expect(strangerGet.body).not.toHaveProperty('ownerEmail');
    expect(strangerGet.body).not.toHaveProperty('ownerId');

    const strangerPerms = await request(app)
      .get(`/api/maps/${mapId}/permissions`)
      .set({ 'x-mock-user': JSON.stringify(strangerUser) });
    expect(strangerPerms.status).toBe(200);
    expect(strangerPerms.body.userRole).toBe('view');
    expect(strangerPerms.body.owner).toEqual(expect.objectContaining({
      id: mockUser.id,
      name: mockUser.name,
      email: mockUser.email,
    }));
    expect(strangerPerms.body.permissions).toEqual([
      {
        userId: strangerUser.id,
        userEmail: strangerUser.email,
        userName: strangerUser.name,
        userPicture: null,
        role: 'view'
      }
    ]);

    // Verify permission row was persisted in the database
    const strangerPerm = await db.get('SELECT * FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, strangerUser.id);
    expect(strangerPerm).toEqual({ map_id: mapId, user_id: strangerUser.id, role: 'view' });

    // Verify map is now in stranger's accessible maps list
    const strangerMaps = await request(app)
      .get('/api/maps')
      .set({ 'x-mock-user': JSON.stringify(strangerUser) });
    expect(strangerMaps.status).toBe(200);
    expect(strangerMaps.body.map((m: any) => m.id)).toContain(mapId);

    const ownerGet = await request(app).get(`/api/maps/${mapId}`).set(authHeader);
    expect(ownerGet.status).toBe(200);
    expect(ownerGet.body.userRole).toBe('owner');
    expect(ownerGet.body).not.toHaveProperty('ownerEmail');
    expect(ownerGet.body).not.toHaveProperty('ownerId');
    expect(ownerGet.body).not.toHaveProperty('permissions');

    const ownerPerms = await request(app).get(`/api/maps/${mapId}/permissions`).set(authHeader);
    expect(ownerPerms.status).toBe(200);
    expect(ownerPerms.body.owner.email).toBe(mockUser.email);
    expect(ownerPerms.body.owner.id).toBe(mockUser.id);

    // 5. Owner toggles back to private
    const privateToggleRes = await request(app)
      .put(`/api/maps/${mapId}/public`)
      .set(authHeader)
      .send({ isPublic: false });
    expect(privateToggleRes.status).toBe(200);
    expect(privateToggleRes.body.isPublic).toBe(false);

    // 6. Anonymous request is now blocked again
    const reblockedRes = await request(app).get(`/api/maps/${mapId}`);
    expect(reblockedRes.status).toBe(401);

    // 7. Stranger still retains view access since they were added to map_permissions
    const strangerRetainedGet = await request(app)
      .get(`/api/maps/${mapId}`)
      .set({ 'x-mock-user': JSON.stringify(strangerUser) });
    expect(strangerRetainedGet.status).toBe(200);
    expect(strangerRetainedGet.body.userRole).toBe('view');
  });

  it.each([
    '/api/maps/tiles/extract-size',
    '/maps/tiles/extract-size',
    '/api/maps/tiles/stream',
    '/maps/tiles/stream',
  ])('%s requires authentication and accepts a session', async (path) => {
    const unauth = await request(app).post(path).send({});
    expect(unauth.status).toBe(401);

    const auth = await request(app).post(path).set(authHeader).send({});
    expect(auth.status).toBe(400);
    expect(auth.body.error).toMatch(/bbox/i);
  });

  it('POST /api/maps rejects non-UUID ids and invalid pin colors', async () => {
    const badId = await request(app).post('/api/maps').set(authHeader).send({
      id: 'not-a-uuid',
      name: 'Bad',
      layers: [],
      pins: [],
    });
    expect(badId.status).toBe(400);

    const badColor = await request(app).post('/api/maps').set(authHeader).send({
      id: uuid(400),
      name: 'Bad Color',
      layers: [],
      pins: [{ id: uuid(401), lat: 0, lng: 0, color: '#fff" /><script>', position: 0 }],
    });
    expect(badColor.status).toBe(400);
  });

  it('PUT /api/maps cannot move another map\'s pins by reusing their ids', async () => {
    const ownerA = mockUser;
    const ownerB = { id: 'owner-b-id', email: 'b@example.com', name: 'Owner B' };
    const db = await getDb();
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', ownerB.id, ownerB.email, ownerB.name);

    const mapA = uuid(500);
    const mapB = uuid(501);
    const pinId = uuid(502);
    await request(app).post('/api/maps').set(authHeader).send({
      id: mapA,
      name: 'Map A',
      layers: [],
      pins: [{ id: pinId, lat: 1, lng: 2, label: 'Secret', position: 0 }],
    });
    await request(app).post('/api/maps').set({ 'x-mock-user': JSON.stringify(ownerB) }).send({
      id: mapB,
      name: 'Map B',
      layers: [],
      pins: [],
    });

    const steal = await request(app)
      .put(`/api/maps/${mapB}`)
      .set({ 'x-mock-user': JSON.stringify(ownerB) })
      .send({
        pins: [{ id: pinId, lat: 9, lng: 9, label: 'Stolen', position: 0 }],
      });
    expect(steal.status).toBe(200);

    const original = await db.get('SELECT map_id, label FROM pins WHERE id = ?', pinId);
    expect(original.map_id).toBe(mapA);
    expect(original.label).toBe('Secret');
  });
});

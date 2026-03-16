import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
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

  beforeEach(async () => {
    const db = await getDb();
    await db.exec('DELETE FROM pins');
    await db.exec('DELETE FROM maps');
  });

  it('GET /api/hello should return hello message', async () => {
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
      .send(mapData);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(mapId);

    const db = await getDb();
    const map = await db.get('SELECT * FROM maps WHERE id = ?', mapId);
    expect(map.name).toBe('Test Map');

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
    const res = await request(app).post('/api/maps').send(mapData);
    expect(res.status).toBe(400);
  });

  it('GET /api/maps/:id should return 404 for non-existent map', async () => {
    const res = await request(app).get('/api/maps/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Map not found');
  });

  it('GET /api/maps/:id should return map data', async () => {
    const mapId = 'test-map-id';
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', mapId, 'Loaded Map');
    await db.run('INSERT INTO pins (id, map_id, lat, lng, label) VALUES (?, ?, ?, ?, ?)', 
      'p1', mapId, 5, 5, 'L1');

    const res = await request(app).get(`/api/maps/${mapId}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Loaded Map');
    expect(res.body.pins).toHaveLength(1);
  });

  it('PUT /api/maps/:id should update map name and pins', async () => {
    const mapId = 'update-map-id';
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', mapId, 'Old Name');

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
});

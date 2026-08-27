import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getDb, setDbName, closeDb } from '../db';
import { getMapRole, canEditMap, canViewMap } from '../permissions';

const testDbName = '../test-permissions-db.sqlite';

describe('map role checks', () => {
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

  const ownerId = 'owner-user';
  const viewerId = 'viewer-user';
  const editorId = 'editor-user';
  const strangerId = 'stranger-user';
  const mapId = 'role-map-1';

  beforeEach(async () => {
    const db = await getDb();
    await db.exec('DELETE FROM user_map_access');
    await db.exec('DELETE FROM map_permissions');
    await db.exec('DELETE FROM pins');
    await db.exec('DELETE FROM pin_layers');
    await db.exec('DELETE FROM maps');
    await db.exec('DELETE FROM users');

    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', ownerId, 'owner@example.com', 'Owner');
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', viewerId, 'viewer@example.com', 'Viewer');
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', editorId, 'editor@example.com', 'Editor');
    await db.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', strangerId, 'stranger@example.com', 'Stranger');
    await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', mapId, 'Role Map', ownerId);
    await db.run('INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)', mapId, viewerId, 'view');
    await db.run('INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)', mapId, editorId, 'edit');
  });

  it('returns owner, edit, view, or null based on membership', async () => {
    expect(await getMapRole(ownerId, mapId)).toBe('owner');
    expect(await getMapRole(editorId, mapId)).toBe('edit');
    expect(await getMapRole(viewerId, mapId)).toBe('view');
    expect(await getMapRole(strangerId, mapId)).toBeNull();
    expect(await getMapRole(ownerId, 'missing-map')).toBeNull();
  });

  it('allows view-only users to join but not write', async () => {
    const viewRole = await getMapRole(viewerId, mapId);
    expect(canViewMap(viewRole)).toBe(true);
    expect(canEditMap(viewRole)).toBe(false);

    const editRole = await getMapRole(editorId, mapId);
    expect(canEditMap(editRole)).toBe(true);

    const ownerRole = await getMapRole(ownerId, mapId);
    expect(canEditMap(ownerRole)).toBe(true);

    expect(canViewMap(null)).toBe(false);
    expect(canEditMap(null)).toBe(false);
  });
});

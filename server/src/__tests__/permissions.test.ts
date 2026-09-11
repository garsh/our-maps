import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb, setDbName, closeDb } from '../db';
import { getMapRole, canEditMap, canViewMap } from '../permissions';

describe('map role checks', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    setDbName(':memory:');
  });

  afterAll(async () => {
    await closeDb();
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
    await db.run('INSERT INTO maps (id, name, owner_id, is_public) VALUES (?, ?, ?, 1)', 'public-map', 'Public Map', ownerId);
    await db.run('INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)', mapId, viewerId, 'view');
    await db.run('INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)', mapId, editorId, 'edit');
    await db.run('INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)', 'public-map', editorId, 'edit');
  });

  it.each([
    { userId: ownerId, targetMapId: mapId, expected: 'owner' },
    { userId: editorId, targetMapId: mapId, expected: 'edit' },
    { userId: viewerId, targetMapId: mapId, expected: 'view' },
    { userId: strangerId, targetMapId: mapId, expected: null },
    { userId: ownerId, targetMapId: 'missing-map', expected: null },
    { userId: undefined, targetMapId: mapId, expected: null },
    { userId: null, targetMapId: mapId, expected: null },
    { userId: strangerId, targetMapId: 'public-map', expected: 'view' },
    { userId: undefined, targetMapId: 'public-map', expected: 'view' },
    { userId: null, targetMapId: 'public-map', expected: 'view' },
    { userId: editorId, targetMapId: 'public-map', expected: 'edit' },
    { userId: ownerId, targetMapId: 'public-map', expected: 'owner' },
  ])('resolves role $expected for user $userId on map $targetMapId', async ({ userId, targetMapId, expected }) => {
    expect(await getMapRole(userId, targetMapId)).toBe(expected);
  });

  it.each([
    { role: 'owner', canView: true, canEdit: true },
    { role: 'edit', canView: true, canEdit: true },
    { role: 'view', canView: true, canEdit: false },
    { role: null, canView: false, canEdit: false },
  ])('evaluates capability matrix for role $role: view=$canView, edit=$canEdit', ({ role, canView, canEdit }) => {
    expect(canViewMap(role as any)).toBe(canView);
    expect(canEditMap(role as any)).toBe(canEdit);
  });
});

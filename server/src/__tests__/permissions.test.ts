import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getMapRole, canEditMap, canViewMap, addMapViewerIfLinkShared, resolveMapAccess } from '../permissions';
import { setupTestDb, resetTestDb, teardownTestDb, getDb } from './testHelpers';

describe('map role checks', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  const ownerId = 'owner-user';
  const viewerId = 'viewer-user';
  const editorId = 'editor-user';
  const strangerId = 'stranger-user';
  const mapId = 'role-map-1';

  beforeEach(async () => {
    const db = await resetTestDb();

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

  it('resolveMapAccess derives role and collaborator visibility without extra queries', () => {
    expect(resolveMapAccess(ownerId, { owner_id: ownerId, is_public: 0, permission_role: null })).toEqual({
      role: 'owner',
      canSeeCollaborators: true,
    });
    expect(resolveMapAccess(editorId, { owner_id: ownerId, is_public: 0, permission_role: 'edit' })).toEqual({
      role: 'edit',
      canSeeCollaborators: true,
    });
    expect(resolveMapAccess(viewerId, { owner_id: ownerId, is_public: 0, permission_role: 'view' })).toEqual({
      role: 'view',
      canSeeCollaborators: true,
    });
    expect(resolveMapAccess(strangerId, { owner_id: ownerId, is_public: 1, permission_role: null })).toEqual({
      role: 'view',
      canSeeCollaborators: false,
    });
    expect(resolveMapAccess(undefined, { owner_id: ownerId, is_public: 1, permission_role: null })).toEqual({
      role: 'view',
      canSeeCollaborators: false,
    });
    expect(resolveMapAccess(strangerId, { owner_id: ownerId, is_public: 0, permission_role: null })).toEqual({
      role: null,
      canSeeCollaborators: false,
    });
    expect(resolveMapAccess(strangerId, { owner_id: ownerId, is_public: 1, permission_role: null }, { newlyGrantedView: true })).toEqual({
      role: 'view',
      canSeeCollaborators: true,
    });
    expect(resolveMapAccess(ownerId, null)).toEqual({ role: null, canSeeCollaborators: false });
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

  it('hides collaborators from public-link viewers but not explicit shares', () => {
    expect(resolveMapAccess(ownerId, { owner_id: ownerId, is_public: 0, permission_role: null }).canSeeCollaborators).toBe(true);
    expect(resolveMapAccess(editorId, { owner_id: ownerId, is_public: 0, permission_role: 'edit' }).canSeeCollaborators).toBe(true);
    expect(resolveMapAccess(viewerId, { owner_id: ownerId, is_public: 0, permission_role: 'view' }).canSeeCollaborators).toBe(true);
    expect(resolveMapAccess(strangerId, { owner_id: ownerId, is_public: 0, permission_role: null }).canSeeCollaborators).toBe(false);
    expect(resolveMapAccess(strangerId, { owner_id: ownerId, is_public: 1, permission_role: null }).canSeeCollaborators).toBe(false);
    expect(resolveMapAccess(undefined, { owner_id: ownerId, is_public: 1, permission_role: null }).canSeeCollaborators).toBe(false);
    expect(resolveMapAccess(editorId, { owner_id: ownerId, is_public: 1, permission_role: 'edit' }).canSeeCollaborators).toBe(true);
    expect(resolveMapAccess(ownerId, { owner_id: ownerId, is_public: 1, permission_role: null }).canSeeCollaborators).toBe(true);
  });

  it('addMapViewerIfLinkShared grants view permission to logged-in users accessing link-shared maps', async () => {
    const db = await getDb();

    // 1. Anonymous user cannot be added
    expect(await addMapViewerIfLinkShared(undefined, 'public-map')).toBe(false);
    expect(await addMapViewerIfLinkShared(null, 'public-map')).toBe(false);

    // 2. Owner accessing their own map is not added to map_permissions
    expect(await addMapViewerIfLinkShared(ownerId, 'public-map')).toBe(false);
    const ownerPerm = await db.get('SELECT * FROM map_permissions WHERE map_id = ? AND user_id = ?', 'public-map', ownerId);
    expect(ownerPerm).toBeUndefined();

    // 3. Private map does not add viewer
    expect(await addMapViewerIfLinkShared(strangerId, mapId)).toBe(false);
    const privatePerm = await db.get('SELECT * FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, strangerId);
    expect(privatePerm).toBeUndefined();

    // 4. Logged-in stranger accessing public map is granted view permission
    expect(await addMapViewerIfLinkShared(strangerId, 'public-map')).toBe(true);
    const perm = await db.get('SELECT * FROM map_permissions WHERE map_id = ? AND user_id = ?', 'public-map', strangerId);
    expect(perm).toEqual({ map_id: 'public-map', user_id: strangerId, role: 'view' });

    // 5. Subsequent access is idempotent and returns false
    expect(await addMapViewerIfLinkShared(strangerId, 'public-map')).toBe(false);

    // 6. User with existing edit permission is not downgraded
    expect(await addMapViewerIfLinkShared(editorId, 'public-map')).toBe(false);
    const editorPerm = await db.get('SELECT * FROM map_permissions WHERE map_id = ? AND user_id = ?', 'public-map', editorId);
    expect(editorPerm?.role).toBe('edit');
  });
});


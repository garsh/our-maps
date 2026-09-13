import { getDb } from './db';

export type MapRole = 'owner' | 'edit' | 'view';

export function canViewMap(role: MapRole | null | undefined): boolean {
  return role === 'owner' || role === 'edit' || role === 'view';
}

export function canEditMap(role: MapRole | null | undefined): boolean {
  return role === 'owner' || role === 'edit';
}

export async function getMapRole(userId: string | undefined | null, mapId: string): Promise<MapRole | null> {
  if (!mapId) return null;

  const db = await getDb();
  const row = await db.get(
    `SELECT m.owner_id, m.is_public, mp.role
     FROM maps m
     LEFT JOIN map_permissions mp ON m.id = mp.map_id AND mp.user_id = ?
     WHERE m.id = ?`,
    userId || null,
    mapId
  );
  if (!row) return null;

  if (userId && row.owner_id === userId) return 'owner';
  if (row.role === 'edit' || row.role === 'view') return row.role;
  if (Boolean(row.is_public)) return 'view';

  return null;
}

/** Owner or an explicit share row — not implicit public-link view. */
export async function canSeeMapCollaborators(
  userId: string | undefined | null,
  mapId: string
): Promise<boolean> {
  if (!userId || !mapId) return false;

  const db = await getDb();
  const row = await db.get(
    `SELECT m.owner_id, mp.role
     FROM maps m
     LEFT JOIN map_permissions mp ON m.id = mp.map_id AND mp.user_id = ?
     WHERE m.id = ?`,
    userId,
    mapId
  );
  if (!row) return false;
  if (row.owner_id === userId) return true;
  return row.role === 'edit' || row.role === 'view';
}

/**
 * When a logged-in user accesses a map that is shared via link, add that user
 * as having view permissions for the map (unless they are owner or already have a permission).
 * Returns true if a new permission row was inserted.
 */
export async function addMapViewerIfLinkShared(
  userId: string | undefined | null,
  mapId: string,
  mapOrPublic?: { owner_id?: string | null; is_public?: number | boolean | null }
): Promise<boolean> {
  if (!userId || !mapId) return false;

  const db = await getDb();
  let ownerId = mapOrPublic?.owner_id;
  let isPublic = mapOrPublic?.is_public;

  if (ownerId === undefined || isPublic === undefined) {
    const map = await db.get('SELECT owner_id, is_public FROM maps WHERE id = ?', mapId);
    if (!map) return false;
    ownerId = map.owner_id;
    isPublic = map.is_public;
  }

  if (!Boolean(isPublic) || ownerId === userId) {
    return false;
  }

  const result = await db.run(`
    INSERT INTO map_permissions (map_id, user_id, role)
    VALUES (?, ?, 'view')
    ON CONFLICT(map_id, user_id) DO NOTHING
  `, mapId, userId);

  return Boolean(result && result.changes && result.changes > 0);
}


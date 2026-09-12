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

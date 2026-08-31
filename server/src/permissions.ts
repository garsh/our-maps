import { getDb } from './db';

export type MapRole = 'owner' | 'edit' | 'view';

export function canViewMap(role: MapRole | null | undefined): boolean {
  return role === 'owner' || role === 'edit' || role === 'view';
}

export function canEditMap(role: MapRole | null | undefined): boolean {
  return role === 'owner' || role === 'edit';
}

export async function getMapRole(userId: string, mapId: string): Promise<MapRole | null> {
  if (!userId || !mapId) return null;

  const db = await getDb();
  const row = await db.get(
    `SELECT m.owner_id, mp.role
     FROM maps m
     LEFT JOIN map_permissions mp ON m.id = mp.map_id AND mp.user_id = ?
     WHERE m.id = ?`,
    userId,
    mapId
  );
  if (!row) return null;

  if (row.owner_id === userId) return 'owner';
  if (row.role === 'edit' || row.role === 'view') return row.role;

  return null;
}

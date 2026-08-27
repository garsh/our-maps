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
  const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
  if (!map) return null;

  if (map.owner_id === userId) return 'owner';

  const perm = await db.get(
    'SELECT role FROM map_permissions WHERE map_id = ? AND user_id = ?',
    mapId,
    userId
  );
  if (perm?.role === 'edit' || perm?.role === 'view') return perm.role;

  return null;
}

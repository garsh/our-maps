import { getDb, touchMapUpdatedAt, runInTransaction } from './db';
import { MAX_LAYERS_PER_MAP, MAX_PINS_PER_MAP } from './schemas';
import type {
  PinCreatePayload,
  PinUpdatePayload,
  PinDeletePayload,
  PinsReorderPayload,
  PinMoveLayerPayload,
  LayerCreatePayload,
  LayerUpdatePayload,
  LayerDeletePayload,
  LayersReorderPayload,
  MapNameUpdatePayload,
  CustomColorsUpdatePayload
} from '@shared/interfaces';
import { insertIdsAt } from '../../shared/pinOrder';

export async function handlePinCreate(data: PinCreatePayload): Promise<boolean | void> {
  const db = await getDb();
  const { mapId, layerId, pin } = data;
  if (!mapId || !pin || !pin.id) return false;

  const existing = await db.get('SELECT id, map_id FROM pins WHERE id = ?', pin.id);
  if (existing && existing.map_id !== mapId) {
    return false;
  }
  if (!existing) {
    const countRow = await db.get('SELECT COUNT(*) as n FROM pins WHERE map_id = ?', mapId);
    if ((countRow?.n ?? 0) >= MAX_PINS_PER_MAP) return false;
  }

  const targetLayerId = pin.layerId || layerId || null;
  if (targetLayerId) {
    const layer = await db.get('SELECT id FROM pin_layers WHERE id = ? AND map_id = ?', targetLayerId, mapId);
    if (!layer) return false;
  }

  await db.run(
    `INSERT INTO pins (id, map_id, layer_id, lat, lng, label, description, address, color, icon, position) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       layer_id = excluded.layer_id,
       lat = excluded.lat,
       lng = excluded.lng,
       label = excluded.label,
       description = excluded.description,
       address = excluded.address,
       color = excluded.color,
       icon = excluded.icon,
       position = excluded.position
     WHERE pins.map_id = excluded.map_id`,
    pin.id,
    mapId,
    targetLayerId,
    pin.lat,
    pin.lng,
    pin.label || null,
    pin.description || null,
    pin.address || null,
    pin.color || 'blue',
    pin.icon || 'default',
    pin.position || 0
  );
  await touchMapUpdatedAt(mapId);
}

export async function handlePinUpdate(data: PinUpdatePayload) {
  const db = await getDb();
  const { mapId, pinId, updates } = data;
  if (!mapId || !pinId || !updates) return;

  const setClauses: string[] = [];
  const params: any[] = [];

  if ('layerId' in updates) {
    const targetLayerId = updates.layerId || null;
    if (targetLayerId) {
      const layer = await db.get('SELECT id FROM pin_layers WHERE id = ? AND map_id = ?', targetLayerId, mapId);
      if (!layer) return false;
    }
    setClauses.push('layer_id = ?');
    params.push(targetLayerId);
  }
  if ('lat' in updates) {
    setClauses.push('lat = ?');
    params.push(updates.lat);
  }
  if ('lng' in updates) {
    setClauses.push('lng = ?');
    params.push(updates.lng);
  }
  if ('label' in updates) {
    setClauses.push('label = ?');
    params.push(updates.label || null);
  }
  if ('description' in updates) {
    setClauses.push('description = ?');
    params.push(updates.description || null);
  }
  if ('address' in updates) {
    setClauses.push('address = ?');
    params.push(updates.address || null);
  }
  if ('color' in updates) {
    setClauses.push('color = ?');
    params.push(updates.color || 'blue');
  }
  if ('icon' in updates) {
    setClauses.push('icon = ?');
    params.push(updates.icon || 'default');
  }
  if ('position' in updates) {
    setClauses.push('position = ?');
    params.push(updates.position || 0);
  }

  if (setClauses.length > 0) {
    params.push(pinId, mapId);
    await db.run(`UPDATE pins SET ${setClauses.join(', ')} WHERE id = ? AND map_id = ?`, ...params);
    await touchMapUpdatedAt(mapId);
  }
}

export async function handlePinDelete(data: PinDeletePayload) {
  const db = await getDb();
  const { mapId, pinId } = data;
  if (!mapId || !pinId) return;

  await db.run('DELETE FROM pins WHERE id = ? AND map_id = ?', pinId, mapId);
  await touchMapUpdatedAt(mapId);
}

async function updateEntityPositions(
  db: any,
  table: 'pins' | 'pin_layers',
  idOrder: string[],
  mapId: string
) {
  if (!idOrder || idOrder.length === 0) return;

  const chunkSize = 500;
  for (let chunkStart = 0; chunkStart < idOrder.length; chunkStart += chunkSize) {
    const chunk = idOrder.slice(chunkStart, chunkStart + chunkSize);
    const whenClauses = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const inPlaceholders = chunk.map(() => '?').join(', ');

    const params: any[] = [];
    chunk.forEach((id, idx) => {
      params.push(id, chunkStart + idx);
    });
    params.push(mapId, ...chunk);

    await db.run(
      `UPDATE ${table} 
       SET position = CASE id ${whenClauses} END 
       WHERE map_id = ? AND id IN (${inPlaceholders})`,
      ...params
    );
  }
}

async function loadLayerPinIds(db: any, mapId: string, layerId: string | null): Promise<string[]> {
  const rows = await loadLayerPinRows(db, mapId, layerId);
  return rows.map((r) => r.id);
}

async function loadLayerPinRows(
  db: any,
  mapId: string,
  layerId: string | null
): Promise<Array<{ id: string; position: number }>> {
  const rows = layerId
    ? await db.all(
        'SELECT id, position FROM pins WHERE map_id = ? AND layer_id = ? ORDER BY position ASC, id ASC',
        mapId,
        layerId
      )
    : await db.all(
        'SELECT id, position FROM pins WHERE map_id = ? AND layer_id IS NULL ORDER BY position ASC, id ASC',
        mapId
      );
  return rows.map((r: { id: string; position: number | null }) => ({
    id: r.id,
    position: r.position ?? 0,
  }));
}

async function updateMovedPinPositions(
  db: any,
  mapId: string,
  layerId: string | null,
  pinIds: string[],
  startPosition: number
) {
  const chunkSize = 500;
  for (let chunkStart = 0; chunkStart < pinIds.length; chunkStart += chunkSize) {
    const chunk = pinIds.slice(chunkStart, chunkStart + chunkSize);
    const whenClauses = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const inPlaceholders = chunk.map(() => '?').join(', ');
    const params: any[] = [layerId];
    chunk.forEach((id, idx) => {
      params.push(id, startPosition + chunkStart + idx);
    });
    params.push(mapId, ...chunk);
    await db.run(
      `UPDATE pins SET layer_id = ?, position = CASE id ${whenClauses} END WHERE map_id = ? AND id IN (${inPlaceholders})`,
      ...params
    );
  }
}

export async function handlePinsReorder(data: PinsReorderPayload) {
  const { mapId, layerId, pinIds, insertIndex } = data;
  if (!mapId || !Array.isArray(pinIds) || pinIds.length === 0) return;

  const db = await getDb();
  if (layerId) {
    const layer = await db.get('SELECT id FROM pin_layers WHERE id = ? AND map_id = ?', layerId, mapId);
    if (!layer) return false;
  }

  await runInTransaction(async (database) => {
    const currentIds = await loadLayerPinIds(database, mapId, layerId || null);
    const layerIdSet = new Set(currentIds);
    const moved = pinIds.filter((id) => layerIdSet.has(id));
    if (moved.length === 0) return;
    await updateEntityPositions(database, 'pins', insertIdsAt(currentIds, moved, insertIndex), mapId);
  });
  await touchMapUpdatedAt(mapId);
}

export async function handlePinMoveLayer(data: PinMoveLayerPayload) {
  const { mapId, pinIds, targetLayerId, destInsertIndex } = data;
  if (!mapId || !Array.isArray(pinIds) || pinIds.length === 0) return;

  const targetLayer = targetLayerId || null;
  const db = await getDb();
  if (targetLayer) {
    const layer = await db.get('SELECT id FROM pin_layers WHERE id = ? AND map_id = ?', targetLayer, mapId);
    if (!layer) return false;
  }

  await runInTransaction(async (database) => {
    const chunkSize = 500;
    const found = new Set<string>();
    for (let i = 0; i < pinIds.length; i += chunkSize) {
      const chunk = pinIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = await database.all(
        `SELECT id FROM pins WHERE map_id = ? AND id IN (${placeholders})`,
        mapId,
        ...chunk
      );
      for (const row of rows) found.add(row.id);
    }
    const moved: string[] = [];
    const seen = new Set<string>();
    for (const id of pinIds) {
      if (seen.has(id) || !found.has(id)) continue;
      seen.add(id);
      moved.push(id);
    }
    if (moved.length === 0) return;

    const destRows = await loadLayerPinRows(database, mapId, targetLayer);
    const staying = destRows.filter((row) => !seen.has(row.id));
    const appends = destInsertIndex >= staying.length;

    if (appends) {
      let maxPosition = -1;
      for (const row of staying) {
        if (row.position > maxPosition) maxPosition = row.position;
      }
      await updateMovedPinPositions(database, mapId, targetLayer, moved, maxPosition + 1);
      return;
    }

    for (let i = 0; i < moved.length; i += chunkSize) {
      const chunk = moved.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      await database.run(
        `UPDATE pins SET layer_id = ? WHERE map_id = ? AND id IN (${placeholders})`,
        targetLayer,
        mapId,
        ...chunk
      );
    }

    // The block landed among pins already in the layer, so that layer's order changed.
    const stayingIds = staying.map((row) => row.id);
    await updateEntityPositions(
      database,
      'pins',
      insertIdsAt(stayingIds, moved, destInsertIndex),
      mapId
    );
  });
  await touchMapUpdatedAt(mapId);
}

export async function handleLayerCreate(data: LayerCreatePayload): Promise<boolean | void> {
  const db = await getDb();
  const { mapId, layer } = data;
  if (!mapId || !layer || !layer.id) return false;

  const existing = await db.get('SELECT id, map_id FROM pin_layers WHERE id = ?', layer.id);
  if (existing && existing.map_id !== mapId) {
    return false;
  }
  if (!existing) {
    const countRow = await db.get('SELECT COUNT(*) as n FROM pin_layers WHERE map_id = ?', mapId);
    if ((countRow?.n ?? 0) >= MAX_LAYERS_PER_MAP) return false;
  }

  await db.run(
    `INSERT INTO pin_layers (id, map_id, name, position) 
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       name = excluded.name,
       position = excluded.position
     WHERE pin_layers.map_id = excluded.map_id`,
    layer.id,
    mapId,
    layer.name,
    layer.position || 0
  );
  await touchMapUpdatedAt(mapId);
}

export async function handleLayerUpdate(data: LayerUpdatePayload) {
  const db = await getDb();
  const { mapId, layerId, updates } = data;
  if (!mapId || !layerId || !updates) return;

  const setClauses: string[] = [];
  const params: any[] = [];

  if ('name' in updates) {
    setClauses.push('name = ?');
    params.push(updates.name);
  }
  if ('position' in updates) {
    setClauses.push('position = ?');
    params.push(updates.position || 0);
  }

  if (setClauses.length > 0) {
    params.push(layerId, mapId);
    await db.run(`UPDATE pin_layers SET ${setClauses.join(', ')} WHERE id = ? AND map_id = ?`, ...params);
    await touchMapUpdatedAt(mapId);
  }
}

export async function handleLayerDelete(data: LayerDeletePayload) {
  const { mapId, layerId } = data;
  if (!mapId || !layerId) return;

  await runInTransaction(async (db) => {
    // Find where to append the moved pins (after last existing default-layer pin).
    const maxRow = await db.get(
      'SELECT MAX(position) as maxPos FROM pins WHERE (layer_id IS NULL OR layer_id = \'\') AND map_id = ?',
      mapId
    );
    let nextPos: number = (maxRow?.maxPos ?? -1) + 1;

    // Move each pin to the default layer, appended in their existing order.
    // Individual UPDATEs are fine at ≤100 pins per map (see AGENTS.md Pin Count Scale).
    const pinsToMove = await db.all(
      'SELECT id FROM pins WHERE layer_id = ? AND map_id = ? ORDER BY position ASC, id ASC',
      layerId, mapId
    );
    for (const { id } of pinsToMove) {
      await db.run(
        'UPDATE pins SET layer_id = NULL, position = ? WHERE id = ? AND map_id = ?',
        nextPos++, id, mapId
      );
    }

    await db.run('DELETE FROM pin_layers WHERE id = ? AND map_id = ?', layerId, mapId);
  });
  await touchMapUpdatedAt(mapId);
}

export async function handleLayersReorder(data: LayersReorderPayload) {
  const { mapId, layerOrder } = data;
  if (!mapId || !Array.isArray(layerOrder)) return;

  await runInTransaction(async (db) => {
    await updateEntityPositions(db, 'pin_layers', layerOrder, mapId);
  });
  await touchMapUpdatedAt(mapId);
}

export async function handleMapNameUpdate(data: MapNameUpdatePayload) {
  const db = await getDb();
  const { mapId, name } = data;
  if (!mapId || !name) return;

  await db.run('UPDATE maps SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', name, mapId);
}

export async function handleCustomColorsUpdate(data: CustomColorsUpdatePayload) {
  const db = await getDb();
  const { mapId, customColors } = data;
  if (!mapId || !Array.isArray(customColors)) return;

  await db.run(
    'UPDATE maps SET custom_colors = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    JSON.stringify(customColors),
    mapId
  );
}

export function revokeUserMapAccess(io: any, userId: string, mapId: string) {
  if (!io || !io.sockets || !io.sockets.sockets) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.user?.id === userId) {
      if (socket.data.mapRoles) {
        socket.data.mapRoles.delete(mapId);
      }
      socket.leave(`map:${mapId}`);
      socket.emit('map-access-revoked', { mapId });
    }
  }
}

export function updateUserMapRole(io: any, userId: string, mapId: string, role: string) {
  if (!io || !io.sockets || !io.sockets.sockets) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.user?.id === userId) {
      if (!socket.data.mapRoles) socket.data.mapRoles = new Map<string, string>();
      socket.data.mapRoles.set(mapId, role);
      socket.emit('map-role-updated', { mapId, role });
    }
  }
}

export async function syncSocketsOnPublicChange(io: any, mapId: string, isPublic: boolean, ownerId: string, db: any) {
  if (!io) return;
  io.to(`map:${mapId}`).emit('map-public-updated', { mapId, isPublic });
  if (isPublic || !io.sockets || !io.sockets.sockets) return;

  const explicitRows = await db.all('SELECT user_id, role FROM map_permissions WHERE map_id = ?', mapId);
  const explicitUsers = new Set<string>(explicitRows.map((r: any) => r.user_id));

  for (const socket of io.sockets.sockets.values()) {
    const uid = socket.data?.user?.id;
    if (!uid || (uid !== ownerId && !explicitUsers.has(uid))) {
      if (socket.rooms && socket.rooms.has(`map:${mapId}`)) {
        if (socket.data.mapRoles) socket.data.mapRoles.delete(mapId);
        socket.leave(`map:${mapId}`);
        socket.emit('map-access-revoked', { mapId });
      }
    }
  }
}

export function disconnectSessionSocket(io: any, sessionId: string) {
  if (!io || !io.sockets || !io.sockets.sockets || !sessionId) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.sessionId === sessionId) {
      socket.disconnect(true);
    }
  }
}

export function disconnectUserSockets(io: any, userId: string) {
  if (!io || !io.sockets || !io.sockets.sockets || !userId) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.user?.id === userId) {
      socket.disconnect(true);
    }
  }
}

import { getDb, touchMapUpdatedAt } from './db';
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
  MapNameUpdatePayload
} from '@shared/interfaces';

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
    pin.layerId || layerId || null,
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
    setClauses.push('layer_id = ?');
    params.push(updates.layerId || null);
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

export async function handlePinsReorder(data: PinsReorderPayload) {
  const db = await getDb();
  const { mapId, pinOrder } = data;
  if (!mapId || !Array.isArray(pinOrder)) return;

  await db.run('BEGIN TRANSACTION');
  try {
    await updateEntityPositions(db, 'pins', pinOrder, mapId);
    await db.run('COMMIT');
    await touchMapUpdatedAt(mapId);
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

export async function handlePinMoveLayer(data: PinMoveLayerPayload) {
  const db = await getDb();
  const { mapId, pinIds, targetLayerId, destPinOrder, sourcePinOrder } = data;
  if (!mapId || !Array.isArray(pinIds) || pinIds.length === 0) return;

  await db.run('BEGIN TRANSACTION');
  try {
    const targetLayer = targetLayerId || null;
    const chunkSize = 500;
    for (let i = 0; i < pinIds.length; i += chunkSize) {
      const chunk = pinIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      await db.run(
        `UPDATE pins SET layer_id = ? WHERE map_id = ? AND id IN (${placeholders})`,
        targetLayer,
        mapId,
        ...chunk
      );
    }

    if (Array.isArray(destPinOrder) && destPinOrder.length > 0) {
      await updateEntityPositions(db, 'pins', destPinOrder, mapId);
    }

    if (Array.isArray(sourcePinOrder) && sourcePinOrder.length > 0) {
      await updateEntityPositions(db, 'pins', sourcePinOrder, mapId);
    }

    await db.run('COMMIT');
    await touchMapUpdatedAt(mapId);
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
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
  const db = await getDb();
  const { mapId, layerId } = data;
  if (!mapId || !layerId) return;

  await db.run('BEGIN TRANSACTION');
  try {
    // Get max position of existing Default Layer pins
    const maxRow = await db.get('SELECT MAX(position) as maxPos FROM pins WHERE (layer_id IS NULL OR layer_id = \'\') AND map_id = ?', mapId);
    let currentPos = (maxRow && maxRow.maxPos !== null && maxRow.maxPos !== undefined) ? maxRow.maxPos + 1 : 0;

    const pinsToMove = await db.all('SELECT id FROM pins WHERE layer_id = ? AND map_id = ? ORDER BY position ASC, id ASC', layerId, mapId);

    if (pinsToMove.length > 0) {
      const pinIds = pinsToMove.map(p => p.id);
      const chunkSize = 500;
      for (let chunkStart = 0; chunkStart < pinIds.length; chunkStart += chunkSize) {
        const chunk = pinIds.slice(chunkStart, chunkStart + chunkSize);
        const whenClauses = chunk.map(() => 'WHEN ? THEN ?').join(' ');
        const inPlaceholders = chunk.map(() => '?').join(', ');
        const params: any[] = [];
        chunk.forEach((id, idx) => {
          params.push(id, currentPos + chunkStart + idx);
        });
        params.push(mapId, ...chunk);
        await db.run(
          `UPDATE pins SET layer_id = NULL, position = CASE id ${whenClauses} END WHERE map_id = ? AND id IN (${inPlaceholders})`,
          ...params
        );
      }
    }

    await db.run('DELETE FROM pin_layers WHERE id = ? AND map_id = ?', layerId, mapId);
    await db.run('COMMIT');
    await touchMapUpdatedAt(mapId);
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

export async function handleLayersReorder(data: LayersReorderPayload) {
  const db = await getDb();
  const { mapId, layerOrder } = data;
  if (!mapId || !Array.isArray(layerOrder)) return;

  await db.run('BEGIN TRANSACTION');
  try {
    await updateEntityPositions(db, 'pin_layers', layerOrder, mapId);
    await db.run('COMMIT');
    await touchMapUpdatedAt(mapId);
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

export async function handleMapNameUpdate(data: MapNameUpdatePayload) {
  const db = await getDb();
  const { mapId, name } = data;
  if (!mapId || !name) return;

  await db.run('UPDATE maps SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', name, mapId);
}

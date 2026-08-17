import { getDb } from './db';
import type {
  PinCreatePayload,
  PinUpdatePayload,
  PinDeletePayload,
  PinsReorderPayload,
  LayerCreatePayload,
  LayerUpdatePayload,
  LayerDeletePayload,
  LayersReorderPayload,
  MapNameUpdatePayload
} from '@shared/interfaces';

export async function handlePinCreate(data: PinCreatePayload) {
  const db = await getDb();
  const { mapId, layerId, pin } = data;
  if (!mapId || !pin || !pin.id) return;

  await db.run(
    `INSERT INTO pins (id, map_id, layer_id, lat, lng, label, description, address, image_url, color, icon, position) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       map_id = excluded.map_id,
       layer_id = excluded.layer_id,
       lat = excluded.lat,
       lng = excluded.lng,
       label = excluded.label,
       description = excluded.description,
       address = excluded.address,
       image_url = excluded.image_url,
       color = excluded.color,
       icon = excluded.icon,
       position = excluded.position`,
    pin.id,
    mapId,
    pin.layerId || layerId || null,
    pin.lat,
    pin.lng,
    pin.label || null,
    pin.description || null,
    pin.address || null,
    pin.imageUrl || null,
    pin.color || 'blue',
    pin.icon || 'default',
    pin.position || 0
  );
}

export async function handlePinUpdate(data: PinUpdatePayload) {
  const db = await getDb();
  const { mapId, pinId, updates } = data;
  if (!mapId || !pinId || !updates) return;

  const existing = await db.get('SELECT * FROM pins WHERE id = ? AND map_id = ?', pinId, mapId);
  if (!existing) return; // Target pin deleted, ignore safely

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
  if ('imageUrl' in updates) {
    setClauses.push('image_url = ?');
    params.push(updates.imageUrl || null);
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
  }
}

export async function handlePinDelete(data: PinDeletePayload) {
  const db = await getDb();
  const { mapId, pinId } = data;
  if (!mapId || !pinId) return;

  await db.run('DELETE FROM pins WHERE id = ? AND map_id = ?', pinId, mapId);
}

export async function handlePinsReorder(data: PinsReorderPayload) {
  const db = await getDb();
  const { mapId, pinOrder } = data;
  if (!mapId || !Array.isArray(pinOrder)) return;

  const stmt = await db.prepare('UPDATE pins SET position = ? WHERE id = ? AND map_id = ?');
  for (let i = 0; i < pinOrder.length; i++) {
    await stmt.run(i, pinOrder[i], mapId);
  }
  await stmt.finalize();
}

export async function handleLayerCreate(data: LayerCreatePayload) {
  const db = await getDb();
  const { mapId, layer } = data;
  if (!mapId || !layer || !layer.id) return;

  await db.run(
    `INSERT INTO pin_layers (id, map_id, name, position) 
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       map_id = excluded.map_id,
       name = excluded.name,
       position = excluded.position`,
    layer.id,
    mapId,
    layer.name,
    layer.position || 0
  );
}

export async function handleLayerUpdate(data: LayerUpdatePayload) {
  const db = await getDb();
  const { mapId, layerId, updates } = data;
  if (!mapId || !layerId || !updates) return;

  const existing = await db.get('SELECT * FROM pin_layers WHERE id = ? AND map_id = ?', layerId, mapId);
  if (!existing) return;

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
  }
}

export async function handleLayerDelete(data: LayerDeletePayload) {
  const db = await getDb();
  const { mapId, layerId } = data;
  if (!mapId || !layerId) return;

  // Get max position of existing Default Layer pins
  const maxRow = await db.get('SELECT MAX(position) as maxPos FROM pins WHERE (layer_id IS NULL OR layer_id = \'\') AND map_id = ?', mapId);
  let currentPos = (maxRow && maxRow.maxPos !== null && maxRow.maxPos !== undefined) ? maxRow.maxPos + 1 : 0;

  const pinsToMove = await db.all('SELECT id FROM pins WHERE layer_id = ? AND map_id = ? ORDER BY position ASC, id ASC', layerId, mapId);

  const stmt = await db.prepare('UPDATE pins SET layer_id = NULL, position = ? WHERE id = ? AND map_id = ?');
  for (const pin of pinsToMove) {
    await stmt.run(currentPos, pin.id, mapId);
    currentPos += 1;
  }
  await stmt.finalize();

  await db.run('DELETE FROM pin_layers WHERE id = ? AND map_id = ?', layerId, mapId);
}

export async function handleLayersReorder(data: LayersReorderPayload) {
  const db = await getDb();
  const { mapId, layerOrder } = data;
  if (!mapId || !Array.isArray(layerOrder)) return;

  const stmt = await db.prepare('UPDATE pin_layers SET position = ? WHERE id = ? AND map_id = ?');
  for (let i = 0; i < layerOrder.length; i++) {
    await stmt.run(i, layerOrder[i], mapId);
  }
  await stmt.finalize();
}

export async function handleMapNameUpdate(data: MapNameUpdatePayload) {
  const db = await getDb();
  const { mapId, name } = data;
  if (!mapId || !name) return;

  await db.run('UPDATE maps SET name = ? WHERE id = ?', name, mapId);
}

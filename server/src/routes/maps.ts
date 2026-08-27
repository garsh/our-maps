import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db';
import type { Pin, MapData, MapPermission, PinLayer } from '@shared/interfaces';
import { authMiddleware, type AuthRequest } from '../auth';
import { getMapRole, canEditMap } from '../permissions';
import { MapCreateSchema, MapUpdateSchema, ShareSchema } from '../schemas';
import { z } from 'zod';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// GET all accessible maps for the landing page
router.get('/', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const db = await getDb();

  // Get owned maps and shared maps, ordered by last access
  // Use LEFT JOIN to avoid losing maps if a user was deleted or if using mock IDs
  const maps = await db.all(`
    SELECT m.*, u.name as owner_name, u.email as owner_email, uma.last_accessed_at
    FROM maps m
    LEFT JOIN users u ON m.owner_id = u.id
    LEFT JOIN map_permissions mp ON m.id = mp.map_id AND mp.user_id = ?
    LEFT JOIN user_map_access uma ON m.id = uma.map_id AND uma.user_id = ?
    WHERE m.owner_id = ? OR mp.user_id = ?
    ORDER BY uma.last_accessed_at DESC NULLS LAST, m.name ASC
  `, userId, userId, userId, userId);

  res.json(maps.map(m => ({
    id: m.id,
    name: m.name,
    ownerId: m.owner_id,
    ownerName: m.owner_name || 'Legacy User',
    ownerEmail: m.owner_email || 'legacy@example.com',
    lastAccessedAt: m.last_accessed_at
  })));
});

// GET map and its pins
router.get('/:id', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const mapId = req.params.id;
  const db = await getDb();

  const map = await db.get(`
    SELECT m.*, u.name as owner_name, u.email as owner_email, u.picture as owner_picture 
    FROM maps m 
    LEFT JOIN users u ON m.owner_id = u.id 
    WHERE m.id = ?
  `, mapId);
  
  if (!map) {
    return res.status(404).json({ error: 'Map not found' });
  }

  const role = await getMapRole(userId, mapId);
  if (!role) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Update Last Accessed
  await db.run(`
    INSERT INTO user_map_access (user_id, map_id, last_accessed_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP) 
    ON CONFLICT(user_id, map_id) DO UPDATE SET last_accessed_at = CURRENT_TIMESTAMP
  `, userId, mapId);

  const layers = await db.all('SELECT * FROM pin_layers WHERE map_id = ? ORDER BY position ASC, id ASC', mapId);
  const pins = await db.all('SELECT * FROM pins WHERE map_id = ? ORDER BY position ASC, id ASC', mapId);
  
  // Get permissions for all users who have access
  let permissions: MapPermission[] = [];
  const perms = await db.all(`
    SELECT mp.user_id, mp.role, u.email, u.name, u.picture
    FROM map_permissions mp
    JOIN users u ON mp.user_id = u.id 
    WHERE mp.map_id = ?
  `, mapId);
  permissions = perms.map(p => ({ userId: p.user_id, userEmail: p.email, userName: p.name, userPicture: p.picture, role: p.role }));

  // Map fields for frontend consistency
  const formattedPins = pins.map(p => {
    const { image_url: _imageUrl, layer_id, ...rest } = p;
    return {
      ...rest,
      layerId: layer_id,
      address: p.address,
      color: p.color || 'blue',
      icon: p.icon || 'default',
      position: p.position || 0
    };
  });

  const response: MapData = {
    ...map,
    ownerId: map.owner_id,
    ownerName: map.owner_name,
    ownerEmail: map.owner_email,
    ownerPicture: map.owner_picture,
    layers: layers || [],
    pins: formattedPins,
    userRole: role,
    permissions
  };

  res.json(response);
});

// GET map permissions and owner info without transferring pins or layers
router.get('/:id/permissions', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const mapId = req.params.id;
  const db = await getDb();

  const map = await db.get(`
    SELECT m.id, m.owner_id, u.name as owner_name, u.email as owner_email, u.picture as owner_picture 
    FROM maps m 
    LEFT JOIN users u ON m.owner_id = u.id 
    WHERE m.id = ?
  `, mapId);

  if (!map) {
    return res.status(404).json({ error: 'Map not found' });
  }

  const role = await getMapRole(userId, mapId);
  if (!role) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const perms = await db.all(`
    SELECT mp.user_id, mp.role, u.email, u.name, u.picture
    FROM map_permissions mp
    JOIN users u ON mp.user_id = u.id 
    WHERE mp.map_id = ?
  `, mapId);

  const permissions: MapPermission[] = perms.map(p => ({
    userId: p.user_id,
    userEmail: p.email,
    userName: p.name,
    userPicture: p.picture,
    role: p.role
  }));

  res.json({
    owner: {
      id: map.owner_id,
      name: map.owner_name,
      email: map.owner_email,
      picture: map.owner_picture
    },
    permissions,
    userRole: role
  });
});

// Helper to batch-query existing entity IDs in chunks (eliminates sequential N+1 round-trips)
async function getExistingIds(
  db: any,
  table: 'pins' | 'pin_layers',
  ids: (string | undefined | null)[],
  mapIdFilter?: { mapId: string; notEqual: boolean }
): Promise<Set<string>> {
  const validIds = ids.filter((id): id is string => Boolean(id));
  if (validIds.length === 0) return new Set();

  const existingSet = new Set<string>();
  const chunkSize = 500;

  for (let i = 0; i < validIds.length; i += chunkSize) {
    const chunk = validIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    let query = `SELECT id FROM ${table} WHERE id IN (${placeholders})`;
    const params: any[] = [...chunk];

    if (mapIdFilter) {
      query += mapIdFilter.notEqual ? ' AND map_id != ?' : ' AND map_id = ?';
      params.push(mapIdFilter.mapId);
    }

    const rows = await db.all(query, ...params);
    for (const row of rows) {
      existingSet.add(row.id);
    }
  }

  return existingSet;
}

// POST new map
router.post('/', async (req: AuthRequest, res) => {
  try {
    const validatedData = MapCreateSchema.parse(req.body);
    const { id, name, layers, pins } = validatedData;
    const userId = req.user!.id;
    const db = await getDb();

    await db.run('BEGIN TRANSACTION');

    try {
      await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', id, name, userId);
      
      const finalGroups: PinLayer[] = [];
      const layerIdMap = new Map<string, string>();
      const processedLayerIds = new Set<string>();

      if (layers && layers.length > 0) {
        const existingLayerIds = await getExistingIds(db, 'pin_layers', layers.map(l => l.id));
        for (const layer of layers) {
          let layerId = layer.id;
          if (!layerId || processedLayerIds.has(layerId) || existingLayerIds.has(layerId)) {
            const newLayerId = crypto.randomUUID();
            if (layerId) layerIdMap.set(layerId, newLayerId);
            layerId = newLayerId;
          }
          processedLayerIds.add(layerId);
          finalGroups.push({ ...layer, id: layerId });
        }

        const layerStmt = await db.prepare('INSERT INTO pin_layers (id, map_id, name, position) VALUES (?, ?, ?, ?)');
        for (const layer of finalGroups) {
          await layerStmt.run(layer.id, id, layer.name, layer.position);
        }
        await layerStmt.finalize();
      }

      const finalPins: Pin[] = [];
      if (pins && pins.length > 0) {
        const processedPinIds = new Set<string>();
        const existingPinIds = await getExistingIds(db, 'pins', pins.map(p => p.id));
        for (const pin of pins) {
          let pinId = pin.id;
          if (!pinId || processedPinIds.has(pinId) || existingPinIds.has(pinId)) {
            pinId = crypto.randomUUID();
          }
          processedPinIds.add(pinId);

          let targetLayerId = pin.layerId || null;
          if (targetLayerId && layerIdMap.has(targetLayerId)) {
            targetLayerId = layerIdMap.get(targetLayerId)!;
          }
          finalPins.push({ ...pin, id: pinId, layerId: targetLayerId || undefined } as Pin);
        }

        const stmt = await db.prepare('INSERT INTO pins (id, map_id, layer_id, lat, lng, label, description, address, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const pin of finalPins) {
          await stmt.run(pin.id, id, pin.layerId || null, pin.lat, pin.lng, pin.label || null, pin.description || null, pin.address || null, pin.color || 'blue', pin.icon || 'default', pin.position);
        }
        await stmt.finalize();
      }

      // Update access time for creator
      await db.run(`
        INSERT INTO user_map_access (user_id, map_id, last_accessed_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `, userId, id);

      await db.run('COMMIT');

      res.status(201).json({ 
        id, 
        name, 
        layers: finalGroups, 
        pins: finalPins,
        ownerId: userId,
        userRole: 'owner'
      });
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    console.error('[SERVER] POST /api/maps ERROR:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT update map (Atomic Sync / Upsert Strategy)
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const validatedData = MapUpdateSchema.parse(req.body);
    const { name, layers, pins } = validatedData;
    const mapId = req.params.id;
    const userId = req.user!.id;
    const db = await getDb();

    const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
    if (!map) return res.status(404).json({ error: 'Map not found' });

    const role = await getMapRole(userId, mapId);
    if (!canEditMap(role)) {
      return res.status(403).json({ error: 'Write access denied' });
    }

    await db.run('BEGIN TRANSACTION');

    try {
      if (name) {
        await db.run('UPDATE maps SET name = ? WHERE id = ?', name, mapId);
      }

      const layerIdMap = new Map<string, string>();
      // 1. Sync Groups: Upsert and Diff
      if (layers !== undefined) {
        const finalGroups: PinLayer[] = [];
        const processedLayerIds = new Set<string>();
        const otherMapLayerIds = await getExistingIds(db, 'pin_layers', layers.map(l => l.id), { mapId, notEqual: true });

        for (const layer of layers) {
          let layerId = layer.id;
          if (!layerId || processedLayerIds.has(layerId) || otherMapLayerIds.has(layerId)) {
            const newLayerId = crypto.randomUUID();
            if (layerId) layerIdMap.set(layerId, newLayerId);
            layerId = newLayerId;
          }
          processedLayerIds.add(layerId);
          finalGroups.push({ ...layer, id: layerId });
        }

        const layerStmt = await db.prepare(`
          INSERT INTO pin_layers (id, map_id, name, position) 
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            map_id = excluded.map_id,
            name = excluded.name,
            position = excluded.position
        `);
        for (const layer of finalGroups) {
          await layerStmt.run(layer.id, mapId, layer.name, layer.position);
        }
        await layerStmt.finalize();
      }

      // 2. Sync Pins: Upsert provided pins
      if (pins !== undefined) {
        const finalPins: Pin[] = [];
        const processedPinIds = new Set<string>();
        const otherMapPinIds = await getExistingIds(db, 'pins', pins.map(p => p.id), { mapId, notEqual: true });

        for (const pin of pins) {
          let pinId = pin.id;
          if (!pinId || processedPinIds.has(pinId) || otherMapPinIds.has(pinId)) {
            pinId = crypto.randomUUID();
          }
          processedPinIds.add(pinId);

          let targetLayerId = pin.layerId || null;
          if (targetLayerId && layerIdMap.has(targetLayerId)) {
            targetLayerId = layerIdMap.get(targetLayerId)!;
          }
          finalPins.push({ ...pin, id: pinId, layerId: targetLayerId || undefined } as Pin);
        }

        // Upsert provided pins
        const pinStmt = await db.prepare(`
          INSERT INTO pins (id, map_id, layer_id, lat, lng, label, description, address, color, icon, position) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            map_id = excluded.map_id,
            layer_id = excluded.layer_id,
            lat = excluded.lat,
            lng = excluded.lng,
            label = excluded.label,
            description = excluded.description,
            address = excluded.address,
            color = excluded.color,
            icon = excluded.icon,
            position = excluded.position
        `);
        for (const pin of finalPins) {
          await pinStmt.run(
            pin.id, mapId, pin.layerId || null, pin.lat, pin.lng, pin.label || null, 
            pin.description || null, pin.address || null, 
            pin.color || 'blue', pin.icon || 'default', pin.position
          );
        }
        await pinStmt.finalize();
      }

      await db.run('COMMIT');

      const io = req.app.get('io');
      if (io) {
        io.to(`map:${mapId}`).emit('map-reloaded', { mapId });
      }

      res.json({ message: 'Map updated successfully' });
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST share map
router.post('/:id/share', async (req: AuthRequest, res) => {
  try {
    const validatedData = ShareSchema.parse(req.body);
    const { email, role } = validatedData;
    const mapId = req.params.id;
    const userId = req.user!.id;
    const db = await getDb();

    // Only owner can share
    const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
    if (!map) return res.status(404).json({ error: 'Map not found' });
    if (map.owner_id !== userId) return res.status(403).json({ error: 'Only owner can share' });

    // Lookup user by email
    const targetUser = await db.get('SELECT id FROM users WHERE email = ?', email);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found. They must sign in at least once.' });
    }

    if (targetUser.id === userId) {
      return res.status(400).json({ error: 'Cannot share with yourself' });
    }

    if (role === 'owner') {
      try {
        await db.run('BEGIN TRANSACTION');
        
        // Remove target user from permissions if they are already there
        await db.run('DELETE FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, targetUser.id);
        
        // Change ownership
        await db.run('UPDATE maps SET owner_id = ? WHERE id = ?', targetUser.id, mapId);
        
        // Add previous owner as an editor
        await db.run(`
          INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, 'edit')
          ON CONFLICT(map_id, user_id) DO UPDATE SET role = 'edit'
        `, mapId, userId);
        
        await db.run('COMMIT');
      } catch (error) {
        await db.run('ROLLBACK');
        throw error;
      }
    } else {
      // Add/Update permission
      await db.run(`
        INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)
        ON CONFLICT(map_id, user_id) DO UPDATE SET role = excluded.role
      `, mapId, targetUser.id, role);
    }

    res.json({ message: 'Map shared', userId: targetUser.id, email, role });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE remove share
router.delete('/:id/share/:userId', async (req: AuthRequest, res) => {
  const mapId = req.params.id;
  const ownerId = req.user!.id;
  const targetUserId = req.params.userId;
  const db = await getDb();

  try {
    const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
    if (!map) return res.status(404).json({ error: 'Map not found' });
    if (map.owner_id !== ownerId && ownerId !== targetUserId) {
      return res.status(403).json({ error: 'Only owner can manage shares, or you can remove yourself' });
    }

    await db.run('DELETE FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, targetUserId);
    res.json({ message: 'Permission removed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE delete map
router.delete('/:id', async (req: AuthRequest, res) => {
  const mapId = req.params.id;
  const userId = req.user!.id;
  const db = await getDb();

  try {
    const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
    if (!map) return res.status(404).json({ error: 'Map not found' });
    if (map.owner_id !== userId) return res.status(403).json({ error: 'Only owner can delete the map' });

    await db.run('DELETE FROM maps WHERE id = ?', mapId);

    const io = req.app.get('io');
    if (io) {
      io.to(`map:${mapId}`).emit('map-deleted', { mapId });
    }

    res.json({ message: 'Map deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

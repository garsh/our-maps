import { Router } from 'express';
import { getDb } from '../db';
import type { Pin, MapData, MapPermission } from '@shared/interfaces';
import { authMiddleware, type AuthRequest } from '../auth';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// GET all accessible maps for the landing page
router.get('/', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const db = await getDb();

  // Get owned maps and shared maps, ordered by last access
  const maps = await db.all(`
    SELECT m.*, u.name as owner_name, u.email as owner_email, uma.last_accessed_at
    FROM maps m
    JOIN users u ON m.owner_id = u.id
    LEFT JOIN map_permissions mp ON m.id = mp.map_id AND mp.user_id = ?
    LEFT JOIN user_map_access uma ON m.id = uma.map_id AND uma.user_id = ?
    WHERE m.owner_id = ? OR mp.user_id = ?
    ORDER BY uma.last_accessed_at DESC NULLS LAST, m.name ASC
  `, userId, userId, userId, userId);

  res.json(maps.map(m => ({
    id: m.id,
    name: m.name,
    ownerId: m.owner_id,
    ownerName: m.owner_name,
    ownerEmail: m.owner_email,
    lastAccessedAt: m.last_accessed_at
  })));
});

// GET map and its pins
router.get('/:id', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const mapId = req.params.id;
  const db = await getDb();
  
  const map = await db.get(`
    SELECT m.*, u.name as owner_name, u.email as owner_email 
    FROM maps m 
    JOIN users u ON m.owner_id = u.id 
    WHERE m.id = ?
  `, mapId);
  
  if (!map) {
    return res.status(404).json({ error: 'Map not found' });
  }

  // Check Permissions
  let role: 'owner' | 'edit' | 'view' | null = null;
  if (map.owner_id === userId) {
    role = 'owner';
  } else {
    const perm = await db.get('SELECT role FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, userId);
    if (perm) role = perm.role;
  }

  if (!role) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Update Last Accessed
  await db.run(`
    INSERT INTO user_map_access (user_id, map_id, last_accessed_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP) 
    ON CONFLICT(user_id, map_id) DO UPDATE SET last_accessed_at = CURRENT_TIMESTAMP
  `, userId, mapId);

  const groups = await db.all('SELECT * FROM pin_groups WHERE map_id = ? ORDER BY position', mapId);
  const pins = await db.all('SELECT * FROM pins WHERE map_id = ? ORDER BY position', mapId);
  
  // Get permissions if owner
  let permissions: MapPermission[] = [];
  if (role === 'owner') {
    const perms = await db.all(`
      SELECT mp.role, u.id as user_id, u.email, u.name 
      FROM map_permissions mp 
      JOIN users u ON mp.user_id = u.id 
      WHERE mp.map_id = ?
    `, mapId);
    permissions = perms.map(p => ({ userId: p.user_id, userEmail: p.email, userName: p.name, role: p.role }));
  }

  // Map fields for frontend consistency
  const formattedPins = pins.map(p => ({
    ...p,
    imageUrl: p.image_url,
    groupId: p.group_id,
    address: p.address,
    color: p.color || 'blue',
    icon: p.icon || 'default',
    position: p.position || 0
  }));

  const response: MapData = {
    ...map,
    ownerId: map.owner_id,
    ownerName: map.owner_name,
    ownerEmail: map.owner_email,
    groups: groups || [],
    pins: formattedPins,
    userRole: role,
    permissions
  };

  res.json(response);
});

// POST new map
router.post('/', async (req: AuthRequest, res) => {
  const { id, name, groups, pins } = req.body;
  const userId = req.user!.id;
  const db = await getDb();

  if (!id || !name) {
    return res.status(400).json({ error: 'Missing map ID or name' });
  }

  try {
    await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', id, name, userId);
    
    if (groups && groups.length > 0) {
      const groupStmt = await db.prepare('INSERT INTO pin_groups (id, map_id, name, position) VALUES (?, ?, ?, ?)');
      for (const group of groups) {
        await groupStmt.run(group.id, id, group.name, group.position || 0);
      }
      await groupStmt.finalize();
    }

    if (pins && pins.length > 0) {
      const stmt = await db.prepare('INSERT INTO pins (id, map_id, group_id, lat, lng, label, description, address, image_url, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const pin of pins) {
        await stmt.run(pin.id, id, pin.groupId || null, pin.lat, pin.lng, pin.label, pin.description, pin.address, pin.imageUrl, pin.color || 'blue', pin.icon || 'default', pin.position || 0);
      }
      await stmt.finalize();
    }

    // Update access time for creator
    await db.run(`
      INSERT INTO user_map_access (user_id, map_id, last_accessed_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `, userId, id);

    console.log('[SERVER] Map created successfully');
    res.status(201).json({ 
      id, 
      name, 
      groups: groups || [], 
      pins: pins || [],
      ownerId: userId,
      userRole: 'owner'
    });
  } catch (error: any) {
    console.error('[SERVER] POST /api/maps ERROR:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT update map
router.put('/:id', async (req: AuthRequest, res) => {
  const { name, groups, pins } = req.body;
  const mapId = req.params.id;
  const userId = req.user!.id;
  const db = await getDb();

  try {
    // Check permissions
    const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
    if (!map) return res.status(404).json({ error: 'Map not found' });

    let hasEditAccess = map.owner_id === userId;
    if (!hasEditAccess) {
      const perm = await db.get('SELECT role FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, userId);
      hasEditAccess = perm && perm.role === 'edit';
    }

    if (!hasEditAccess) {
      return res.status(403).json({ error: 'Write access denied' });
    }

    if (name) {
      await db.run('UPDATE maps SET name = ? WHERE id = ?', name, mapId);
      const map = await db.get('SELECT name FROM maps WHERE id = ?', mapId)
    }

    // Sync Strategy: Clear and Re-insert (Same as before)
    await db.run('DELETE FROM pin_groups WHERE map_id = ?', mapId);
    await db.run('DELETE FROM pins WHERE map_id = ?', mapId);
    
    if (groups && groups.length > 0) {
      const groupStmt = await db.prepare('INSERT INTO pin_groups (id, map_id, name, position) VALUES (?, ?, ?, ?)');
      for (const group of groups) {
        await groupStmt.run(group.id, mapId, group.name, group.position || 0);
      }
      await groupStmt.finalize();
    }

    if (pins && pins.length > 0) {
      const stmt = await db.prepare('INSERT INTO pins (id, map_id, group_id, lat, lng, label, description, address, image_url, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const pin of pins) {
        await stmt.run(pin.id, mapId, pin.groupId || null, pin.lat, pin.lng, pin.label, pin.description, pin.address, pin.imageUrl, pin.color || 'blue', pin.icon || 'default', pin.position || 0);
      }
      await stmt.finalize();
    }

    res.json({ message: 'Map updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST share map
router.post('/:id/share', async (req: AuthRequest, res) => {
  const mapId = req.params.id;
  const userId = req.user!.id;
  const { email, role } = req.body;
  const db = await getDb();

  if (!email || !role || !['view', 'edit'].includes(role)) {
    return res.status(400).json({ error: 'Invalid share request' });
  }

  try {
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

    // Add/Update permission
    await db.run(`
      INSERT INTO map_permissions (map_id, user_id, role) VALUES (?, ?, ?)
      ON CONFLICT(map_id, user_id) DO UPDATE SET role = excluded.role
    `, mapId, targetUser.id, role);

    res.json({ message: 'Map shared', userId: targetUser.id, email, role });
  } catch (error: any) {
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
    if (map.owner_id !== ownerId) return res.status(403).json({ error: 'Only owner can manage shares' });

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
    res.json({ message: 'Map deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

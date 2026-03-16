import { Router } from 'express';
import { getDb } from '../db';
import type { Pin } from '@shared/interfaces';

const router = Router();

// GET map and its pins
router.get('/:id', async (req, res) => {
  const db = await getDb();
  const map = await db.get('SELECT * FROM maps WHERE id = ?', req.params.id);
  
  if (!map) {
    return res.status(404).json({ error: 'Map not found' });
  }

  const groups = await db.all('SELECT * FROM pin_groups WHERE map_id = ? ORDER BY position', req.params.id);
  const pins = await db.all('SELECT * FROM pins WHERE map_id = ? ORDER BY position', req.params.id);
  
  // Map fields for frontend consistency
  const formattedPins = pins.map(p => ({
    ...p,
    imageUrl: p.image_url,
    groupId: p.group_id,
    color: p.color || 'blue',
    icon: p.icon || 'default',
    position: p.position || 0
  }));

  res.json({ ...map, groups: groups || [], pins: formattedPins });
});

// POST new map
router.post('/', async (req, res) => {
  const { id, name, groups, pins } = req.body;
  const db = await getDb();

  if (!id || !name) {
    return res.status(400).json({ error: 'Missing map ID or name' });
  }

  try {
    await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', id, name);
    
    if (groups && groups.length > 0) {
      const groupStmt = await db.prepare('INSERT INTO pin_groups (id, map_id, name, position) VALUES (?, ?, ?, ?)');
      for (const group of groups) {
        await groupStmt.run(group.id, id, group.name, group.position || 0);
      }
      await groupStmt.finalize();
    }

    if (pins && pins.length > 0) {
      const stmt = await db.prepare('INSERT INTO pins (id, map_id, group_id, lat, lng, label, description, image_url, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const pin of pins) {
        await stmt.run(pin.id, id, pin.groupId || null, pin.lat, pin.lng, pin.label, pin.description, pin.imageUrl, pin.color || 'blue', pin.icon || 'default', pin.position || 0);
      }
      await stmt.finalize();
    }

    res.status(201).json({ id, name, groups: groups || [], pins: pins || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update map
router.put('/:id', async (req, res) => {
  const { name, groups, pins } = req.body;
  const db = await getDb();

  try {
    if (name) {
      await db.run('UPDATE maps SET name = ? WHERE id = ?', name, req.params.id);
    }

    // Sync Strategy: Clear and Re-insert
    await db.run('DELETE FROM pin_groups WHERE map_id = ?', req.params.id);
    await db.run('DELETE FROM pins WHERE map_id = ?', req.params.id);
    
    if (groups && groups.length > 0) {
      const groupStmt = await db.prepare('INSERT INTO pin_groups (id, map_id, name, position) VALUES (?, ?, ?, ?)');
      for (const group of groups) {
        await groupStmt.run(group.id, req.params.id, group.name, group.position || 0);
      }
      await groupStmt.finalize();
    }

    if (pins && pins.length > 0) {
      const stmt = await db.prepare('INSERT INTO pins (id, map_id, group_id, lat, lng, label, description, image_url, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const pin of pins) {
        await stmt.run(pin.id, req.params.id, pin.groupId || null, pin.lat, pin.lng, pin.label, pin.description, pin.imageUrl, pin.color || 'blue', pin.icon || 'default', pin.position || 0);
      }
      await stmt.finalize();
    }

    res.json({ message: 'Map updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

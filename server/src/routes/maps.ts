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

  const pins = await db.all('SELECT * FROM pins WHERE map_id = ?', req.params.id);
  // Map image_url to imageUrl for frontend consistency, ensure default color/icon
  const formattedPins = pins.map(p => ({
    ...p,
    imageUrl: p.image_url,
    color: p.color || 'blue',
    icon: p.icon || 'default'
  }));
  res.json({ ...map, pins: formattedPins });
});

// POST new map
router.post('/', async (req, res) => {
  const { id, name, pins } = req.body;
  const db = await getDb();

  if (!id || !name) {
    return res.status(400).json({ error: 'Missing map ID or name' });
  }

  try {
    await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', id, name);
    
    if (pins && pins.length > 0) {
      const stmt = await db.prepare('INSERT INTO pins (id, map_id, lat, lng, label, description, image_url, color, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const pin of pins) {
        await stmt.run(pin.id, id, pin.lat, pin.lng, pin.label, pin.description, pin.imageUrl, pin.color || 'blue', pin.icon || 'default');
      }
      await stmt.finalize();
    }

    res.status(201).json({ id, name, pins: pins || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update pins and name on a map
router.put('/:id', async (req, res) => {
  const { name, pins } = req.body as { name?: string, pins: Pin[] };
  const db = await getDb();

  try {
    if (name) {
      await db.run('UPDATE maps SET name = ? WHERE id = ?', name, req.params.id);
    }

    // Simple sync strategy: Delete all current pins and insert new ones
    await db.run('DELETE FROM pins WHERE map_id = ?', req.params.id);
    
    const stmt = await db.prepare('INSERT INTO pins (id, map_id, lat, lng, label, description, image_url, color, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const pin of pins) {
      await stmt.run(pin.id, req.params.id, pin.lat, pin.lng, pin.label, pin.description, pin.imageUrl, pin.color || 'blue', pin.icon || 'default');
    }
    await stmt.finalize();

    res.json({ message: 'Map updated', count: pins.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

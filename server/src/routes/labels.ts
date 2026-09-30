import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { authMiddleware, type AuthRequest } from '../auth';
import { getDb, runInTransaction } from '../db';
import type { LabelSortMode } from '@shared/interfaces';
import { getMapRole, canViewMap } from '../permissions';

const router = Router();

// All label routes require authentication
router.use(authMiddleware);

const ALLOWED_SORT_MODES = new Set<LabelSortMode>(['last_accessed', 'custom', 'name', 'created_at']);

/**
 * GET /api/labels
 * Fetch all labels, assignments, system settings, and custom system orders for the user.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const db = await getDb();

    const labels = await db.all(
      `SELECT id, user_id as userId, name, sort_mode as sortMode, position, created_at as createdAt
       FROM user_labels
       WHERE user_id = ?
       ORDER BY position ASC, name ASC`,
      userId
    );

    const assignments = await db.all(
      `SELECT label_id as labelId, map_id as mapId, position, added_at as addedAt
       FROM user_map_labels
       WHERE user_id = ?
       ORDER BY position ASC`,
      userId
    );

    const systemSettings = await db.all(
      `SELECT system_label_id as systemLabelId, sort_mode as sortMode
       FROM user_system_label_settings
       WHERE user_id = ?`,
      userId
    );

    const systemOrder = await db.all(
      `SELECT system_label_id as systemLabelId, map_id as mapId, position
       FROM user_system_label_map_order
       WHERE user_id = ?
       ORDER BY position ASC`,
      userId
    );

    res.json({
      labels,
      assignments,
      systemSettings,
      systemOrder,
    });
  } catch (err: any) {
    console.error('[Labels] Failed to fetch labels:', err);
    res.status(500).json({ error: 'Failed to fetch labels' });
  }
});

/**
 * POST /api/labels
 * Create a new user label.
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { name, sortMode } = req.body;

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'Label name is required' });
  }

  const validSortMode: LabelSortMode = ALLOWED_SORT_MODES.has(sortMode) ? sortMode : 'last_accessed';
  const labelId = randomUUID();

  try {
    const db = await getDb();

    // Determine next position
    const maxPosRow = await db.get(
      'SELECT MAX(position) as maxPos FROM user_labels WHERE user_id = ?',
      userId
    );
    const nextPos = (maxPosRow?.maxPos != null) ? Number(maxPosRow.maxPos) + 1 : 0;

    await db.run(
      `INSERT INTO user_labels (id, user_id, name, sort_mode, position)
       VALUES (?, ?, ?, ?, ?)`,
      labelId,
      userId,
      trimmedName,
      validSortMode,
      nextPos
    );

    const newLabel = await db.get(
      `SELECT id, user_id as userId, name, sort_mode as sortMode, position, created_at as createdAt
       FROM user_labels
       WHERE id = ?`,
      labelId
    );

    res.status(201).json(newLabel);
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    console.error('[Labels] Failed to create label:', err);
    res.status(500).json({ error: 'Failed to create label' });
  }
});

/**
 * PUT /api/labels/:id
 * Update label name, sortMode, or position.
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const labelId = req.params.id;
  const { name, sortMode, position } = req.body;

  try {
    const db = await getDb();
    const existing = await db.get('SELECT * FROM user_labels WHERE id = ? AND user_id = ?', labelId, userId);
    if (!existing) {
      return res.status(404).json({ error: 'Label not found' });
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (typeof name === 'string' && name.trim()) {
      updates.push('name = ?');
      values.push(name.trim());
    }
    if (sortMode !== undefined && ALLOWED_SORT_MODES.has(sortMode)) {
      updates.push('sort_mode = ?');
      values.push(sortMode);
    }
    if (typeof position === 'number') {
      updates.push('position = ?');
      values.push(position);
    }

    if (updates.length > 0) {
      values.push(labelId, userId);
      await db.run(
        `UPDATE user_labels SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
        ...values
      );
    }

    const updated = await db.get(
      `SELECT id, user_id as userId, name, sort_mode as sortMode, position, created_at as createdAt
       FROM user_labels
       WHERE id = ?`,
      labelId
    );

    res.json(updated);
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    console.error('[Labels] Failed to update label:', err);
    res.status(500).json({ error: 'Failed to update label' });
  }
});

/**
 * DELETE /api/labels/:id
 * Delete a user label.
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const labelId = req.params.id;

  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM user_labels WHERE id = ? AND user_id = ?', labelId, userId);
    if (!result.changes) {
      return res.status(404).json({ error: 'Label not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Labels] Failed to delete label:', err);
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

/**
 * POST /api/labels/:id/maps
 * Assign a map to a label.
 */
router.post('/:id/maps', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const labelId = req.params.id;
  const { mapId, position } = req.body;

  if (!mapId) {
    return res.status(400).json({ error: 'mapId is required' });
  }

  try {
    const db = await getDb();
    const role = await getMapRole(userId, mapId);
    if (!canViewMap(role)) {
      return res.status(404).json({ error: 'Map not found' });
    }

    const label = await db.get('SELECT id FROM user_labels WHERE id = ? AND user_id = ?', labelId, userId);
    if (!label) {
      return res.status(404).json({ error: 'Label not found' });
    }

    let pos = position;
    if (typeof pos !== 'number') {
      const maxPos = await db.get(
        'SELECT MAX(position) as maxPos FROM user_map_labels WHERE user_id = ? AND label_id = ?',
        userId,
        labelId
      );
      pos = (maxPos?.maxPos != null) ? Number(maxPos.maxPos) + 1 : 0;
    }

    await db.run(
      `INSERT INTO user_map_labels (user_id, label_id, map_id, position)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, label_id, map_id) DO UPDATE SET position = excluded.position`,
      userId,
      labelId,
      mapId,
      pos
    );

    res.json({ success: true, labelId, mapId, position: pos });
  } catch (err: any) {
    console.error('[Labels] Failed to assign map to label:', err);
    res.status(500).json({ error: 'Failed to assign map to label' });
  }
});

/**
 * DELETE /api/labels/:id/maps/:mapId
 * Remove a map from a label.
 */
router.delete('/:id/maps/:mapId', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const labelId = req.params.id;
  const mapId = req.params.mapId;

  try {
    const db = await getDb();
    await db.run(
      'DELETE FROM user_map_labels WHERE user_id = ? AND label_id = ? AND map_id = ?',
      userId,
      labelId,
      mapId
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Labels] Failed to unassign map from label:', err);
    res.status(500).json({ error: 'Failed to remove map from label' });
  }
});

/**
 * PUT /api/labels/:id/order
 * Reorder maps in a custom label.
 */
router.put('/:id/order', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const labelId = req.params.id;
  const { mapIds } = req.body;

  if (!Array.isArray(mapIds)) {
    return res.status(400).json({ error: 'mapIds array is required' });
  }

  try {
    await runInTransaction(async (db) => {
      for (let i = 0; i < mapIds.length; i++) {
        await db.run(
          `UPDATE user_map_labels SET position = ? WHERE user_id = ? AND label_id = ? AND map_id = ?`,
          i,
          userId,
          labelId,
          mapIds[i]
        );
      }
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Labels] Failed to update map order:', err);
    res.status(500).json({ error: 'Failed to update map order' });
  }
});

/**
 * PUT /api/labels/system/:systemLabelId/settings
 * Set sort mode preference for a system label.
 */
router.put('/system/:systemLabelId/settings', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const systemLabelId = req.params.systemLabelId;
  const { sortMode } = req.body;

  if (!ALLOWED_SORT_MODES.has(sortMode)) {
    return res.status(400).json({ error: 'Invalid sortMode' });
  }

  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO user_system_label_settings (user_id, system_label_id, sort_mode)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, system_label_id) DO UPDATE SET sort_mode = excluded.sort_mode`,
      userId,
      systemLabelId,
      sortMode
    );
    res.json({ success: true, systemLabelId, sortMode });
  } catch (err: any) {
    console.error('[Labels] Failed to update system label settings:', err);
    res.status(500).json({ error: 'Failed to update system label settings' });
  }
});

/**
 * PUT /api/labels/system/:systemLabelId/order
 * Reorder maps in a system label.
 */
router.put('/system/:systemLabelId/order', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const systemLabelId = req.params.systemLabelId;
  const { mapIds } = req.body;

  if (!Array.isArray(mapIds)) {
    return res.status(400).json({ error: 'mapIds array is required' });
  }

  try {
    await runInTransaction(async (db) => {
      for (let i = 0; i < mapIds.length; i++) {
        await db.run(
          `INSERT INTO user_system_label_map_order (user_id, system_label_id, map_id, position)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, system_label_id, map_id) DO UPDATE SET position = excluded.position`,
          userId,
          systemLabelId,
          mapIds[i],
          i
        );
      }
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Labels] Failed to update system label map order:', err);
    res.status(500).json({ error: 'Failed to update system label map order' });
  }
});

/**
 * POST /api/labels/system/:systemLabelId/maps
 * Add a map to a system label (e.g. favorites).
 */
router.post('/system/:systemLabelId/maps', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const systemLabelId = req.params.systemLabelId;
  const { mapId } = req.body;

  if (!mapId) {
    return res.status(400).json({ error: 'mapId is required' });
  }

  try {
    const db = await getDb();
    const role = await getMapRole(userId, mapId);
    if (!canViewMap(role)) {
      return res.status(404).json({ error: 'Map not found' });
    }

    const maxPos = await db.get(
      'SELECT MAX(position) as maxPos FROM user_system_label_map_order WHERE user_id = ? AND system_label_id = ?',
      userId,
      systemLabelId
    );
    const pos = (maxPos?.maxPos != null) ? Number(maxPos.maxPos) + 1 : 0;

    await db.run(
      `INSERT INTO user_system_label_map_order (user_id, system_label_id, map_id, position)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, system_label_id, map_id) DO NOTHING`,
      userId,
      systemLabelId,
      mapId,
      pos
    );
    res.json({ success: true, systemLabelId, mapId });
  } catch (err: any) {
    console.error('[Labels] Failed to add map to system label:', err);
    res.status(500).json({ error: 'Failed to add map to system label' });
  }
});

/**
 * DELETE /api/labels/system/:systemLabelId/maps/:mapId
 * Remove a map from a system label (e.g. favorites).
 */
router.delete('/system/:systemLabelId/maps/:mapId', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const systemLabelId = req.params.systemLabelId;
  const mapId = req.params.mapId;

  try {
    const db = await getDb();
    await db.run(
      'DELETE FROM user_system_label_map_order WHERE user_id = ? AND system_label_id = ? AND map_id = ?',
      userId,
      systemLabelId,
      mapId
    );
    res.json({ success: true, systemLabelId, mapId });
  } catch (err: any) {
    console.error('[Labels] Failed to remove map from system label:', err);
    res.status(500).json({ error: 'Failed to remove map from system label' });
  }
});

export default router;

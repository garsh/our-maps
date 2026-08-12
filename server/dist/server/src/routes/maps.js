"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const auth_1 = require("../auth");
const schemas_1 = require("../schemas");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// Apply auth middleware to all routes
router.use(auth_1.authMiddleware);
// GET all accessible maps for the landing page
router.get('/', async (req, res) => {
    const userId = req.user.id;
    const db = await (0, db_1.getDb)();
    // Get owned maps and shared maps, ordered by last access
    // Use LEFT JOIN to avoid losing maps if a user was deleted or if using mock IDs
    const maps = await db.all(`
    SELECT m.*, u.name as owner_name, u.email as owner_email, uma.last_accessed_at
    FROM maps m
    LEFT JOIN users u ON m.owner_id = u.id
    LEFT JOIN map_permissions mp ON m.id = mp.map_id AND mp.user_id = ?
    LEFT JOIN user_map_access uma ON m.id = uma.map_id AND uma.user_id = ?
    WHERE m.owner_id = ? OR mp.user_id = ? OR m.owner_id = 'mock-user-id'
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
router.get('/:id', async (req, res) => {
    const userId = req.user.id;
    const mapId = req.params.id;
    const db = await (0, db_1.getDb)();
    console.log(`[SERVER] GET /api/maps/${mapId} requested by user ${userId}`);
    const map = await db.get(`
    SELECT m.*, u.name as owner_name, u.email as owner_email, u.picture as owner_picture 
    FROM maps m 
    LEFT JOIN users u ON m.owner_id = u.id 
    WHERE m.id = ?
  `, mapId);
    if (!map) {
        console.warn(`[SERVER] Map ${mapId} not found in database`);
        return res.status(404).json({ error: 'Map not found' });
    }
    // Check Permissions
    let role = null;
    console.log(`[SERVER] Map owner: ${map.owner_id}, Current user: ${userId}`);
    // Determine role with legacy fallbacks
    const isLegacyOwner = map.owner_id === 'mock-user-id';
    const isCurrentUserMock = userId === 'mock-user-id';
    if (map.owner_id === userId || isLegacyOwner || (isCurrentUserMock && process.env.NODE_ENV !== 'production')) {
        role = 'owner';
    }
    else {
        const perm = await db.get('SELECT role FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, userId);
        if (perm)
            role = perm.role;
    }
    if (!role) {
        console.error(`[SERVER] Access denied for user ${userId} to map ${mapId}`);
        return res.status(403).json({ error: 'Access denied' });
    }
    console.log(`[SERVER] Access granted! Role: ${role}`);
    // Update Last Accessed
    await db.run(`
    INSERT INTO user_map_access (user_id, map_id, last_accessed_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP) 
    ON CONFLICT(user_id, map_id) DO UPDATE SET last_accessed_at = CURRENT_TIMESTAMP
  `, userId, mapId);
    const groups = await db.all('SELECT * FROM pin_groups WHERE map_id = ? ORDER BY position', mapId);
    const pins = await db.all('SELECT * FROM pins WHERE map_id = ? ORDER BY position', mapId);
    // Get permissions for all users who have access
    let permissions = [];
    const perms = await db.all(`
    SELECT mp.user_id, mp.role, u.email, u.name, u.picture
    FROM map_permissions mp
    JOIN users u ON mp.user_id = u.id 
    WHERE mp.map_id = ?
  `, mapId);
    permissions = perms.map(p => ({ userId: p.user_id, userEmail: p.email, userName: p.name, userPicture: p.picture, role: p.role }));
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
    const response = {
        ...map,
        ownerId: map.owner_id,
        ownerName: map.owner_name,
        ownerEmail: map.owner_email,
        ownerPicture: map.owner_picture,
        groups: groups || [],
        pins: formattedPins,
        userRole: role,
        permissions
    };
    res.json(response);
});
// POST new map
router.post('/', async (req, res) => {
    try {
        const validatedData = schemas_1.MapCreateSchema.parse(req.body);
        const { id, name, groups, pins } = validatedData;
        const userId = req.user.id;
        const db = await (0, db_1.getDb)();
        await db.run('BEGIN TRANSACTION');
        try {
            await db.run('INSERT INTO maps (id, name, owner_id) VALUES (?, ?, ?)', id, name, userId);
            const finalGroups = [];
            const groupIdMap = new Map();
            const processedGroupIds = new Set();
            if (groups && groups.length > 0) {
                for (const group of groups) {
                    let groupId = group.id;
                    const existingGroup = groupId ? await db.get('SELECT id FROM pin_groups WHERE id = ?', groupId) : null;
                    if (!groupId || processedGroupIds.has(groupId) || existingGroup) {
                        const newGroupId = crypto_1.default.randomUUID();
                        if (groupId)
                            groupIdMap.set(groupId, newGroupId);
                        groupId = newGroupId;
                    }
                    processedGroupIds.add(groupId);
                    finalGroups.push({ ...group, id: groupId });
                }
                const groupStmt = await db.prepare('INSERT INTO pin_groups (id, map_id, name, position) VALUES (?, ?, ?, ?)');
                for (const group of finalGroups) {
                    await groupStmt.run(group.id, id, group.name, group.position);
                }
                await groupStmt.finalize();
            }
            const finalPins = [];
            if (pins && pins.length > 0) {
                const processedPinIds = new Set();
                for (const pin of pins) {
                    let pinId = pin.id;
                    const existingPin = pinId ? await db.get('SELECT id FROM pins WHERE id = ?', pinId) : null;
                    if (!pinId || processedPinIds.has(pinId) || existingPin) {
                        pinId = crypto_1.default.randomUUID();
                    }
                    processedPinIds.add(pinId);
                    let targetGroupId = pin.groupId || null;
                    if (targetGroupId && groupIdMap.has(targetGroupId)) {
                        targetGroupId = groupIdMap.get(targetGroupId);
                    }
                    finalPins.push({ ...pin, id: pinId, groupId: targetGroupId || undefined });
                }
                const stmt = await db.prepare('INSERT INTO pins (id, map_id, group_id, lat, lng, label, description, address, image_url, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                for (const pin of finalPins) {
                    await stmt.run(pin.id, id, pin.groupId || null, pin.lat, pin.lng, pin.label || null, pin.description || null, pin.address || null, pin.imageUrl || null, pin.color || 'blue', pin.icon || 'default', pin.position);
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
                groups: finalGroups,
                pins: finalPins,
                ownerId: userId,
                userRole: 'owner'
            });
        }
        catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.issues });
        }
        console.error('[SERVER] POST /api/maps ERROR:', error);
        res.status(500).json({ error: error.message });
    }
});
// PUT update map (Atomic Sync / Upsert Strategy)
router.put('/:id', async (req, res) => {
    try {
        const validatedData = schemas_1.MapUpdateSchema.parse(req.body);
        const { name, groups, pins } = validatedData;
        const mapId = req.params.id;
        const userId = req.user.id;
        const db = await (0, db_1.getDb)();
        // Check permissions
        const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
        if (!map)
            return res.status(404).json({ error: 'Map not found' });
        let hasEditAccess = map.owner_id === userId;
        if (!hasEditAccess) {
            const perm = await db.get('SELECT role FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, userId);
            hasEditAccess = perm && perm.role === 'edit';
        }
        if (!hasEditAccess) {
            return res.status(403).json({ error: 'Write access denied' });
        }
        await db.run('BEGIN TRANSACTION');
        try {
            if (name) {
                await db.run('UPDATE maps SET name = ? WHERE id = ?', name, mapId);
            }
            const groupIdMap = new Map();
            // 1. Sync Groups: Upsert and Diff
            if (groups !== undefined) {
                const finalGroups = [];
                const processedGroupIds = new Set();
                for (const group of groups) {
                    let groupId = group.id;
                    const existingOtherGroup = groupId ? await db.get('SELECT map_id FROM pin_groups WHERE id = ? AND map_id != ?', groupId, mapId) : null;
                    if (!groupId || processedGroupIds.has(groupId) || existingOtherGroup) {
                        const newGroupId = crypto_1.default.randomUUID();
                        if (groupId)
                            groupIdMap.set(groupId, newGroupId);
                        groupId = newGroupId;
                    }
                    processedGroupIds.add(groupId);
                    finalGroups.push({ ...group, id: groupId });
                }
                const providedGroupIds = finalGroups.map(g => g.id);
                // Remove groups not in provided list
                if (providedGroupIds.length > 0) {
                    await db.run(`DELETE FROM pin_groups WHERE map_id = ? AND id NOT IN (${providedGroupIds.map(() => '?').join(',')})`, mapId, ...providedGroupIds);
                }
                else {
                    await db.run('DELETE FROM pin_groups WHERE map_id = ?', mapId);
                }
                // Upsert provided groups
                const groupStmt = await db.prepare(`
          INSERT INTO pin_groups (id, map_id, name, position) 
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            map_id = excluded.map_id,
            name = excluded.name,
            position = excluded.position
        `);
                for (const group of finalGroups) {
                    await groupStmt.run(group.id, mapId, group.name, group.position);
                }
                await groupStmt.finalize();
            }
            // 2. Sync Pins: Upsert and Diff
            if (pins !== undefined) {
                const finalPins = [];
                const processedPinIds = new Set();
                for (const pin of pins) {
                    let pinId = pin.id;
                    const existingOtherPin = pinId ? await db.get('SELECT map_id FROM pins WHERE id = ? AND map_id != ?', pinId, mapId) : null;
                    if (!pinId || processedPinIds.has(pinId) || existingOtherPin) {
                        pinId = crypto_1.default.randomUUID();
                    }
                    processedPinIds.add(pinId);
                    let targetGroupId = pin.groupId || null;
                    if (targetGroupId && groupIdMap.has(targetGroupId)) {
                        targetGroupId = groupIdMap.get(targetGroupId);
                    }
                    finalPins.push({ ...pin, id: pinId, groupId: targetGroupId || undefined });
                }
                const providedPinIds = finalPins.map(p => p.id);
                // Remove pins not in provided list
                if (providedPinIds.length > 0) {
                    await db.run(`DELETE FROM pins WHERE map_id = ? AND id NOT IN (${providedPinIds.map(() => '?').join(',')})`, mapId, ...providedPinIds);
                }
                else {
                    await db.run('DELETE FROM pins WHERE map_id = ?', mapId);
                }
                // Upsert provided pins
                const pinStmt = await db.prepare(`
          INSERT INTO pins (id, map_id, group_id, lat, lng, label, description, address, image_url, color, icon, position) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            map_id = excluded.map_id,
            group_id = excluded.group_id,
            lat = excluded.lat,
            lng = excluded.lng,
            label = excluded.label,
            description = excluded.description,
            address = excluded.address,
            image_url = excluded.image_url,
            color = excluded.color,
            icon = excluded.icon,
            position = excluded.position
        `);
                for (const pin of finalPins) {
                    await pinStmt.run(pin.id, mapId, pin.groupId || null, pin.lat, pin.lng, pin.label || null, pin.description || null, pin.address || null, pin.imageUrl || null, pin.color || 'blue', pin.icon || 'default', pin.position);
                }
                await pinStmt.finalize();
            }
            await db.run('COMMIT');
            res.json({ message: 'Map updated successfully' });
        }
        catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});
// POST share map
router.post('/:id/share', async (req, res) => {
    try {
        const validatedData = schemas_1.ShareSchema.parse(req.body);
        const { email, role } = validatedData;
        const mapId = req.params.id;
        const userId = req.user.id;
        const db = await (0, db_1.getDb)();
        // Only owner can share
        const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
        if (!map)
            return res.status(404).json({ error: 'Map not found' });
        if (map.owner_id !== userId)
            return res.status(403).json({ error: 'Only owner can share' });
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
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Validation failed', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});
// DELETE remove share
router.delete('/:id/share/:userId', async (req, res) => {
    const mapId = req.params.id;
    const ownerId = req.user.id;
    const targetUserId = req.params.userId;
    const db = await (0, db_1.getDb)();
    try {
        const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
        if (!map)
            return res.status(404).json({ error: 'Map not found' });
        if (map.owner_id !== ownerId)
            return res.status(403).json({ error: 'Only owner can manage shares' });
        await db.run('DELETE FROM map_permissions WHERE map_id = ? AND user_id = ?', mapId, targetUserId);
        res.json({ message: 'Permission removed' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// DELETE delete map
router.delete('/:id', async (req, res) => {
    const mapId = req.params.id;
    const userId = req.user.id;
    const db = await (0, db_1.getDb)();
    try {
        const map = await db.get('SELECT owner_id FROM maps WHERE id = ?', mapId);
        if (!map)
            return res.status(404).json({ error: 'Map not found' });
        if (map.owner_id !== userId)
            return res.status(403).json({ error: 'Only owner can delete the map' });
        await db.run('DELETE FROM maps WHERE id = ?', mapId);
        res.json({ message: 'Map deleted' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;

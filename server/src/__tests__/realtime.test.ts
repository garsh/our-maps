import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb } from '../db';
import * as realtime from '../realtime';
import { setupTestDb, resetTestDb, teardownTestDb } from './testHelpers';

describe('Realtime Delta Handlers', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  const mapId = 'realtime-map-1';

  beforeEach(async () => {
    const db = await resetTestDb();
    await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', mapId, 'Test Map');
  });

  it('handlePinCreate & handlePinUpdate & handlePinDelete', async () => {
    const db = await getDb();
    const pin = {
      id: 'pin-1',
      lat: 40.7128,
      lng: -74.006,
      label: 'New York',
      position: 0
    };

    await realtime.handlePinCreate({ mapId, pin });
    let storedPin = await db.get('SELECT * FROM pins WHERE id = ?', 'pin-1');
    expect(storedPin).toBeDefined();
    expect(storedPin.label).toBe('New York');

    await realtime.handlePinUpdate({ mapId, pinId: 'pin-1', updates: { label: 'NYC Updated' } });
    storedPin = await db.get('SELECT * FROM pins WHERE id = ?', 'pin-1');
    expect(storedPin.label).toBe('NYC Updated');

    await realtime.handlePinDelete({ mapId, pinId: 'pin-1' });
    storedPin = await db.get('SELECT * FROM pins WHERE id = ?', 'pin-1');
    expect(storedPin).toBeUndefined();
  });

  it('handleLayerCreate & handleLayerDelete reassigning pins to Default Layer', async () => {
    const db = await getDb();
    const layer = { id: 'layer-1', name: 'Custom Layer', position: 0 };
    await realtime.handleLayerCreate({ mapId, layer });

    const pin = { id: 'pin-2', lat: 34.0522, lng: -118.2437, label: 'LA', layerId: 'layer-1', position: 0 };
    await realtime.handlePinCreate({ mapId, pin });

    let storedPin = await db.get('SELECT * FROM pins WHERE id = ?', 'pin-2');
    expect(storedPin.layer_id).toBe('layer-1');

    await realtime.handleLayerDelete({ mapId, layerId: 'layer-1' });
    const storedLayer = await db.get('SELECT * FROM pin_layers WHERE id = ?', 'layer-1');
    expect(storedLayer).toBeUndefined();

    storedPin = await db.get('SELECT * FROM pins WHERE id = ?', 'pin-2');
    expect(storedPin.layer_id).toBeNull();
  });

  it('handleLayerDelete reassigns pins to the END of Default Layer with sequential position', async () => {
    const db = await getDb();
    // Existing default layer pin at position 5
    await realtime.handlePinCreate({ mapId, pin: { id: 'default-pin-1', lat: 0, lng: 0, label: 'Default Pin', position: 5 } });
    
    // Layer 1 with 2 pins
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-A', name: 'Layer A', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'layer-pin-1', layerId: 'layer-A', lat: 0, lng: 0, label: 'L Pin 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'layer-pin-2', layerId: 'layer-A', lat: 0, lng: 0, label: 'L Pin 2', position: 1 } });

    await realtime.handleLayerDelete({ mapId, layerId: 'layer-A' });

    const p1 = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'layer-pin-1');
    const p2 = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'layer-pin-2');

    expect(p1.layer_id).toBeNull();
    expect(p2.layer_id).toBeNull();
    expect(p1.position).toBe(6);
    expect(p2.position).toBe(7);
  });

  it('handlePinsReorder & handleLayersReorder', async () => {
    const db = await getDb();
    await realtime.handlePinCreate({ mapId, pin: { id: 'p1', lat: 0, lng: 0, label: 'P1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p2', lat: 1, lng: 1, label: 'P2', position: 1 } });

    await realtime.handlePinsReorder({ mapId, pinIds: ['p2'], insertIndex: 0 });
    const p1 = await db.get('SELECT position FROM pins WHERE id = ?', 'p1');
    const p2 = await db.get('SELECT position FROM pins WHERE id = ?', 'p2');
    expect(p2.position).toBe(0);
    expect(p1.position).toBe(1);
  });

  it('handleMapNameUpdate', async () => {
    const db = await getDb();
    await realtime.handleMapNameUpdate({ mapId, name: 'Renamed Map' });
    const map = await db.get('SELECT name FROM maps WHERE id = ?', mapId);
    expect(map.name).toBe('Renamed Map');
  });

  it('handleLayerDelete executes atomically in a transaction', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-tx', name: 'TX Layer', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'pin-tx-1', layerId: 'layer-tx', lat: 10, lng: 20, label: 'TX Pin 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'pin-tx-2', layerId: 'layer-tx', lat: 11, lng: 21, label: 'TX Pin 2', position: 1 } });

    await realtime.handleLayerDelete({ mapId, layerId: 'layer-tx' });

    const deletedLayer = await db.get('SELECT * FROM pin_layers WHERE id = ?', 'layer-tx');
    expect(deletedLayer).toBeUndefined();

    const pins = await db.all('SELECT * FROM pins WHERE map_id = ? ORDER BY position ASC, id ASC', mapId);
    expect(pins.length).toBe(2);
    expect(pins[0].layer_id).toBeNull();
    expect(pins[1].layer_id).toBeNull();
  });

  it('handlePinMoveLayer appends a pin and keeps the positions of pins that stay', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-src', name: 'Source Layer', position: 0 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-dst', name: 'Dest Layer', position: 1 } });

    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-1', layerId: 'layer-src', lat: 1, lng: 1, label: 'Src 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-2', layerId: 'layer-src', lat: 2, lng: 2, label: 'Src 2', position: 1 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-1', layerId: 'layer-dst', lat: 3, lng: 3, label: 'Dst 1', position: 0 } });

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['p-src-1'],
      targetLayerId: 'layer-dst',
      destInsertIndex: 1,
    });

    const movedPin = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-1');
    expect(movedPin.layer_id).toBe('layer-dst');
    expect(movedPin.position).toBe(1);

    const stayingDest = await db.get('SELECT position FROM pins WHERE id = ?', 'p-dst-1');
    expect(stayingDest.position).toBe(0);

    const remainingSrc = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-2');
    expect(remainingSrc.layer_id).toBe('layer-src');
    expect(remainingSrc.position).toBe(1);
  });

  it('handlePinMoveLayer appends after the destination max and keeps a gapped source position', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-src', name: 'Source Layer', position: 0 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-dst', name: 'Dest Layer', position: 1 } });

    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-1', layerId: 'layer-src', lat: 1, lng: 1, label: 'Src 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-2', layerId: 'layer-src', lat: 2, lng: 2, label: 'Src 2', position: 4 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-1', layerId: 'layer-dst', lat: 3, lng: 3, label: 'Dst 1', position: 5 } });

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['p-src-1'],
      targetLayerId: 'layer-dst',
      destInsertIndex: 1,
    });

    const movedPin = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-1');
    expect(movedPin.layer_id).toBe('layer-dst');
    expect(movedPin.position).toBe(6);

    const stayingDest = await db.get('SELECT position FROM pins WHERE id = ?', 'p-dst-1');
    expect(stayingDest.position).toBe(5);

    const remainingSrc = await db.get('SELECT position FROM pins WHERE id = ?', 'p-src-2');
    expect(remainingSrc.position).toBe(4);
  });

  it('handlePinMoveLayer rewrites the destination when the block is inserted in the middle', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-src', name: 'Source Layer', position: 0 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-dst', name: 'Dest Layer', position: 1 } });

    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-1', layerId: 'layer-src', lat: 1, lng: 1, label: 'Src 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-2', layerId: 'layer-src', lat: 2, lng: 2, label: 'Src 2', position: 4 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-1', layerId: 'layer-dst', lat: 3, lng: 3, label: 'Dst 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-2', layerId: 'layer-dst', lat: 4, lng: 4, label: 'Dst 2', position: 5 } });

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['p-src-1'],
      targetLayerId: 'layer-dst',
      destInsertIndex: 0,
    });

    const dest = await db.all(
      'SELECT id, position FROM pins WHERE layer_id = ? ORDER BY position ASC, id ASC',
      'layer-dst'
    );
    expect(dest.map((row: { id: string; position: number }) => [row.id, row.position])).toEqual([
      ['p-src-1', 0],
      ['p-dst-1', 1],
      ['p-dst-2', 2],
    ]);

    const remainingSrc = await db.get('SELECT position FROM pins WHERE id = ?', 'p-src-2');
    expect(remainingSrc.position).toBe(4);
  });

  async function positionsInLayer(layerId: string | null) {
    const db = await getDb();
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
    return rows.map((row: { id: string; position: number }) => [row.id, row.position]);
  }

  it('handlePinMoveLayer appends a block in payload order and leaves another layer gapped', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-src', name: 'Source Layer', position: 0 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-dst', name: 'Dest Layer', position: 1 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-other', name: 'Other Layer', position: 2 } });

    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-1', layerId: 'layer-src', lat: 1, lng: 1, label: 'Src 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-2', layerId: 'layer-src', lat: 2, lng: 2, label: 'Src 2', position: 1 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-3', layerId: 'layer-src', lat: 3, lng: 3, label: 'Src 3', position: 4 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-1', layerId: 'layer-dst', lat: 4, lng: 4, label: 'Dst 1', position: 5 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-other-1', layerId: 'layer-other', lat: 5, lng: 5, label: 'Other 1', position: 2 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-other-2', layerId: 'layer-other', lat: 6, lng: 6, label: 'Other 2', position: 9 } });

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['p-src-2', 'p-src-1'],
      targetLayerId: 'layer-dst',
      destInsertIndex: 1,
    });

    expect(await positionsInLayer('layer-dst')).toEqual([
      ['p-dst-1', 5],
      ['p-src-2', 6],
      ['p-src-1', 7],
    ]);
    const remainingSrc = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-3');
    expect(remainingSrc.layer_id).toBe('layer-src');
    expect(remainingSrc.position).toBe(4);
    expect(await positionsInLayer('layer-other')).toEqual([
      ['p-other-1', 2],
      ['p-other-2', 9],
    ]);
  });

  it('handlePinMoveLayer moves a pin already in the destination to the end without packing the others', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-src', name: 'Source Layer', position: 0 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-dst', name: 'Dest Layer', position: 1 } });

    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-a', layerId: 'layer-dst', lat: 1, lng: 1, label: 'A', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-m', layerId: 'layer-dst', lat: 2, lng: 2, label: 'M', position: 3 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-b', layerId: 'layer-dst', lat: 3, lng: 3, label: 'B', position: 5 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-1', layerId: 'layer-src', lat: 4, lng: 4, label: 'Src 1', position: 1 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-2', layerId: 'layer-src', lat: 5, lng: 5, label: 'Src 2', position: 4 } });

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['p-dst-b', 'p-src-1'],
      targetLayerId: 'layer-dst',
      destInsertIndex: 2,
    });

    expect(await positionsInLayer('layer-dst')).toEqual([
      ['p-dst-a', 0],
      ['p-dst-m', 3],
      ['p-dst-b', 4],
      ['p-src-1', 5],
    ]);
    const remainingSrc = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-2');
    expect(remainingSrc.layer_id).toBe('layer-src');
    expect(remainingSrc.position).toBe(4);
  });

  it('handlePinMoveLayer appends when destInsertIndex is past the end and ignores unknown or duplicate ids', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-src', name: 'Source Layer', position: 0 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-dst', name: 'Dest Layer', position: 1 } });

    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-1', layerId: 'layer-src', lat: 1, lng: 1, label: 'Src 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-2', layerId: 'layer-src', lat: 2, lng: 2, label: 'Src 2', position: 4 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-1', layerId: 'layer-dst', lat: 3, lng: 3, label: 'Dst 1', position: 5 } });

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['missing', 'p-src-1', 'p-src-1'],
      targetLayerId: 'layer-dst',
      destInsertIndex: 50,
    });

    expect(await positionsInLayer('layer-dst')).toEqual([
      ['p-dst-1', 5],
      ['p-src-1', 6],
    ]);
    const remainingSrc = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-2');
    expect(remainingSrc.layer_id).toBe('layer-src');
    expect(remainingSrc.position).toBe(4);
    const count = await db.get('SELECT COUNT(*) as n FROM pins WHERE map_id = ?', mapId);
    expect(count.n).toBe(3);

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['missing'],
      targetLayerId: 'layer-dst',
      destInsertIndex: 0,
    });
    expect(await positionsInLayer('layer-dst')).toEqual([
      ['p-dst-1', 5],
      ['p-src-1', 6],
    ]);
    expect((await db.get('SELECT position FROM pins WHERE id = ?', 'p-src-2')).position).toBe(4);
  });

  it('handlePinMoveLayer appends onto the default layer after its max position', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-src', name: 'Source Layer', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-def-1', lat: 1, lng: 1, label: 'Default 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-def-2', lat: 2, lng: 2, label: 'Default 2', position: 7 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-1', layerId: 'layer-src', lat: 3, lng: 3, label: 'Src 1', position: 2 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-2', layerId: 'layer-src', lat: 4, lng: 4, label: 'Src 2', position: 4 } });

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['p-src-1'],
      targetLayerId: null,
      destInsertIndex: 2,
    });

    expect(await positionsInLayer(null)).toEqual([
      ['p-def-1', 0],
      ['p-def-2', 7],
      ['p-src-1', 8],
    ]);
    const remainingSrc = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-2');
    expect(remainingSrc.layer_id).toBe('layer-src');
    expect(remainingSrc.position).toBe(4);
  });

  it('handlePinMoveLayer rewrites the destination when the block is inserted between gapped pins', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-src', name: 'Source Layer', position: 0 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-dst', name: 'Dest Layer', position: 1 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-other', name: 'Other Layer', position: 2 } });

    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-1', layerId: 'layer-dst', lat: 1, lng: 1, label: 'Dst 1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-dst-2', layerId: 'layer-dst', lat: 2, lng: 2, label: 'Dst 2', position: 5 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-1', layerId: 'layer-src', lat: 3, lng: 3, label: 'Src 1', position: 2 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-src-2', layerId: 'layer-src', lat: 4, lng: 4, label: 'Src 2', position: 4 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-other-1', layerId: 'layer-other', lat: 5, lng: 5, label: 'Other', position: 9 } });

    await realtime.handlePinMoveLayer({
      mapId,
      pinIds: ['p-src-1'],
      targetLayerId: 'layer-dst',
      destInsertIndex: 1,
    });

    expect(await positionsInLayer('layer-dst')).toEqual([
      ['p-dst-1', 0],
      ['p-src-1', 1],
      ['p-dst-2', 2],
    ]);
    const remainingSrc = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-2');
    expect(remainingSrc.layer_id).toBe('layer-src');
    expect(remainingSrc.position).toBe(4);
    expect(await positionsInLayer('layer-other')).toEqual([['p-other-1', 9]]);
  });

  it('handlePinsReorder packs only the named layer and ignores a pin from another layer', async () => {
    const db = await getDb();
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-a', name: 'Layer A', position: 0 } });
    await realtime.handleLayerCreate({ mapId, layer: { id: 'layer-b', name: 'Layer B', position: 1 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-a-1', layerId: 'layer-a', lat: 1, lng: 1, label: 'A1', position: 0 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-a-2', layerId: 'layer-a', lat: 2, lng: 2, label: 'A2', position: 5 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-b-1', layerId: 'layer-b', lat: 3, lng: 3, label: 'B1', position: 2 } });
    await realtime.handlePinCreate({ mapId, pin: { id: 'p-b-2', layerId: 'layer-b', lat: 4, lng: 4, label: 'B2', position: 9 } });

    await realtime.handlePinsReorder({
      mapId,
      layerId: 'layer-a',
      pinIds: ['p-a-1', 'p-b-1'],
      insertIndex: 1,
    });

    expect(await positionsInLayer('layer-a')).toEqual([
      ['p-a-2', 0],
      ['p-a-1', 1],
    ]);
    const untouched = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-b-1');
    expect(untouched.layer_id).toBe('layer-b');
    expect(untouched.position).toBe(2);
    expect(await positionsInLayer('layer-b')).toEqual([
      ['p-b-1', 2],
      ['p-b-2', 9],
    ]);
  });

  it('handlePinCreate does not move a pin that already belongs to another map', async () => {
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', 'other-map', 'Other Map');
    await realtime.handlePinCreate({
      mapId: 'other-map',
      pin: { id: 'shared-pin-id', lat: 1, lng: 1, label: 'Original', position: 0 }
    });

    const applied = await realtime.handlePinCreate({
      mapId,
      pin: { id: 'shared-pin-id', lat: 2, lng: 2, label: 'Stolen', position: 0 }
    });
    expect(applied).toBe(false);

    const pin = await db.get('SELECT * FROM pins WHERE id = ?', 'shared-pin-id');
    expect(pin.map_id).toBe('other-map');
    expect(pin.label).toBe('Original');
    expect(pin.lat).toBe(1);
  });

  it('handleLayerCreate does not move a layer that already belongs to another map', async () => {
    const db = await getDb();
    await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', 'other-map', 'Other Map');
    await realtime.handleLayerCreate({
      mapId: 'other-map',
      layer: { id: 'shared-layer-id', name: 'Original Layer', position: 0 }
    });

    const applied = await realtime.handleLayerCreate({
      mapId,
      layer: { id: 'shared-layer-id', name: 'Stolen Layer', position: 1 }
    });
    expect(applied).toBe(false);

    const layer = await db.get('SELECT * FROM pin_layers WHERE id = ?', 'shared-layer-id');
    expect(layer.map_id).toBe('other-map');
    expect(layer.name).toBe('Original Layer');
  });

  describe('revokeUserMapAccess and updateUserMapRole', () => {
    it('revokes map access and evicts socket from room', () => {
      const emitted: Array<{ event: string; data: any }> = [];
      const leftRooms: string[] = [];
      const mockSocket: any = {
        id: 's1',
        data: {
          user: { id: 'user-to-revoke' },
          mapRoles: new Map([['map-1', 'edit']])
        },
        leave: (room: string) => leftRooms.push(room),
        emit: (event: string, data: any) => emitted.push({ event, data })
      };
      const mockIo: any = {
        sockets: {
          sockets: new Map([['s1', mockSocket]])
        }
      };

      realtime.revokeUserMapAccess(mockIo, 'user-to-revoke', 'map-1');

      expect(mockSocket.data.mapRoles.has('map-1')).toBe(false);
      expect(leftRooms).toContain('map:map-1');
      expect(emitted).toContainEqual({ event: 'map-access-revoked', data: { mapId: 'map-1' } });
    });

    it('updates user role on socket and emits map-role-updated', () => {
      const emitted: Array<{ event: string; data: any }> = [];
      const mockSocket: any = {
        id: 's1',
        data: {
          user: { id: 'user-to-update' },
          mapRoles: new Map([['map-1', 'edit']])
        },
        emit: (event: string, data: any) => emitted.push({ event, data })
      };
      const mockIo: any = {
        sockets: {
          sockets: new Map([['s1', mockSocket]])
        }
      };

      realtime.updateUserMapRole(mockIo, 'user-to-update', 'map-1', 'view');

      expect(mockSocket.data.mapRoles.get('map-1')).toBe('view');
      expect(emitted).toContainEqual({ event: 'map-role-updated', data: { mapId: 'map-1', role: 'view' } });
    });

    it('disconnectSessionSocket disconnects matching session socket', () => {
      let disconnected = false;
      const mockSocket: any = {
        id: 's-sess',
        data: { sessionId: 'target-session-id' },
        disconnect: (close: boolean) => { disconnected = close; }
      };
      const mockIo: any = {
        sockets: {
          sockets: new Map([['s-sess', mockSocket]])
        }
      };

      realtime.disconnectSessionSocket(mockIo, 'target-session-id');
      expect(disconnected).toBe(true);
    });

    it('disconnectUserSockets disconnects all sockets for user', () => {
      let disconnected1 = false;
      let disconnected2 = false;
      const mockSocket1: any = {
        id: 's-user-1',
        data: { user: { id: 'user-logout-everywhere' } },
        disconnect: (close: boolean) => { disconnected1 = close; }
      };
      const mockSocket2: any = {
        id: 's-user-2',
        data: { user: { id: 'other-user' } },
        disconnect: (close: boolean) => { disconnected2 = close; }
      };
      const mockIo: any = {
        sockets: {
          sockets: new Map([['s1', mockSocket1], ['s2', mockSocket2]])
        }
      };

      realtime.disconnectUserSockets(mockIo, 'user-logout-everywhere');
      expect(disconnected1).toBe(true);
      expect(disconnected2).toBe(false);
    });
  });

  describe('Foreign Layer Integrity', () => {
    it('rejects pin creation with layerId from another map', async () => {
      const db = await getDb();
      await db.run('INSERT INTO maps (id, name) VALUES (?, ?)', 'other-map', 'Other Map');
      await realtime.handleLayerCreate({ mapId: 'other-map', layer: { id: 'other-layer', name: 'Other Layer', position: 0 } });

      const res = await realtime.handlePinCreate({
        mapId,
        pin: { id: 'foreign-pin', lat: 10, lng: 10, label: 'Foreign Pin', position: 0, layerId: 'other-layer' }
      });
      expect(res).toBe(false);

      const stored = await db.get('SELECT * FROM pins WHERE id = ?', 'foreign-pin');
      expect(stored).toBeUndefined();
    });

    it('rejects pin update with layerId from another map', async () => {
      const db = await getDb();
      await realtime.handlePinCreate({ mapId, pin: { id: 'valid-pin', lat: 10, lng: 10, label: 'Valid Pin', position: 0 } });

      const res = await realtime.handlePinUpdate({
        mapId,
        pinId: 'valid-pin',
        updates: { layerId: 'non-existent-or-foreign-layer' }
      });
      expect(res).toBe(false);

      const stored = await db.get('SELECT layer_id FROM pins WHERE id = ?', 'valid-pin');
      expect(stored.layer_id).toBeNull();
    });
  });
});


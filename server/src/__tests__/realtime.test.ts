import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb, setDbName, closeDb } from '../db';
import * as realtime from '../realtime';
import * as fs from 'fs';
import * as path from 'path';

const testDbName = '../test-realtime-db.sqlite';

describe('Realtime Delta Handlers', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    setDbName(testDbName);
  });

  afterAll(async () => {
    await closeDb();
    const dbPath = path.join(__dirname, '..', testDbName);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  const mapId = 'realtime-map-1';

  beforeEach(async () => {
    const db = await getDb();
    await db.exec('DELETE FROM pins');
    await db.exec('DELETE FROM pin_layers');
    await db.exec('DELETE FROM maps');
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

    await realtime.handlePinsReorder({ mapId, pinOrder: ['p2', 'p1'] });
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

  it('handlePinMoveLayer moves pins across layers atomically with position reordering', async () => {
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
      destPinOrder: ['p-dst-1', 'p-src-1'],
      sourceLayerId: 'layer-src',
      sourcePinOrder: ['p-src-2']
    });

    const movedPin = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-1');
    expect(movedPin.layer_id).toBe('layer-dst');
    expect(movedPin.position).toBe(1);

    const remainingSrc = await db.get('SELECT layer_id, position FROM pins WHERE id = ?', 'p-src-2');
    expect(remainingSrc.layer_id).toBe('layer-src');
    expect(remainingSrc.position).toBe(0);
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
});

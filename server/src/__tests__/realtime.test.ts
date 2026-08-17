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
});

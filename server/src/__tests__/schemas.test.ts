import { describe, it, expect } from 'vitest';
import {
  MapCreateSchema,
  MAX_LAYERS_PER_MAP,
  MAX_PINS_PER_MAP,
  socketPayloadSchemas,
} from '../schemas';

const PinCreatePayloadSchema = socketPayloadSchemas['pin-create'];
const PinUpdatePayloadSchema = socketPayloadSchemas['pin-update'];

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe('map size limits', () => {
  it('rejects more than MAX_PINS_PER_MAP pins', () => {
    const pins = Array.from({ length: MAX_PINS_PER_MAP + 1 }, (_, i) => ({
      id: uuid(i + 1),
      lat: 0,
      lng: 0,
    }));
    const result = MapCreateSchema.safeParse({ id: uuid(0), name: 'Too Many', pins });
    expect(result.success).toBe(false);
  });

  it('rejects more than MAX_LAYERS_PER_MAP layers', () => {
    const layers = Array.from({ length: MAX_LAYERS_PER_MAP + 1 }, (_, i) => ({
      id: uuid(i + 1),
      name: `Layer ${i}`,
    }));
    const result = MapCreateSchema.safeParse({ id: uuid(0), name: 'Too Many', layers });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID map and pin ids', () => {
    expect(MapCreateSchema.safeParse({ id: 'map-1', name: 'Nope' }).success).toBe(false);
    expect(PinCreatePayloadSchema.safeParse({
      mapId: uuid(1),
      pin: { id: 'pin-1', lat: 10, lng: 20 },
    }).success).toBe(false);
  });

  it('rejects unsafe pin colors and accepts named or hex colors', () => {
    const base = { mapId: uuid(1), pin: { id: uuid(2), lat: 10, lng: 20, position: 0 } };
    expect(PinCreatePayloadSchema.safeParse({
      ...base,
      pin: { ...base.pin, color: 'blue' },
    }).success).toBe(true);
    expect(PinCreatePayloadSchema.safeParse({
      ...base,
      pin: { ...base.pin, color: '#abc' },
    }).success).toBe(true);
    expect(PinCreatePayloadSchema.safeParse({
      ...base,
      pin: { ...base.pin, color: '#fff" onerror="' },
    }).success).toBe(false);
  });
});

describe('socket payload schemas', () => {
  it('accepts a well-formed pin-create payload', () => {
    const result = PinCreatePayloadSchema.safeParse({
      mapId: uuid(1),
      pin: { id: uuid(2), lat: 10, lng: 20, label: 'Here', position: 0 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects pin-create with invalid coordinates', () => {
    const result = PinCreatePayloadSchema.safeParse({
      mapId: uuid(1),
      pin: { id: uuid(2), lat: 999, lng: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('does not inject default position on pin-update', () => {
    const result = PinUpdatePayloadSchema.safeParse({
      mapId: uuid(1),
      pinId: uuid(2),
      updates: { label: 'Renamed' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates.position).toBeUndefined();
    }
  });
});

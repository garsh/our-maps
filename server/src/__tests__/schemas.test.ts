import { describe, it, expect } from 'vitest';
import {
  MapCreateSchema,
  MAX_LAYERS_PER_MAP,
  MAX_PINS_PER_MAP,
  PinCreatePayloadSchema,
  PinUpdatePayloadSchema,
} from '../schemas';

describe('map size limits', () => {
  it('rejects more than MAX_PINS_PER_MAP pins', () => {
    const pins = Array.from({ length: MAX_PINS_PER_MAP + 1 }, (_, i) => ({
      id: `pin-${i}`,
      lat: 0,
      lng: 0,
    }));
    const result = MapCreateSchema.safeParse({ id: 'map-1', name: 'Too Many', pins });
    expect(result.success).toBe(false);
  });

  it('rejects more than MAX_LAYERS_PER_MAP layers', () => {
    const layers = Array.from({ length: MAX_LAYERS_PER_MAP + 1 }, (_, i) => ({
      id: `layer-${i}`,
      name: `Layer ${i}`,
    }));
    const result = MapCreateSchema.safeParse({ id: 'map-1', name: 'Too Many', layers });
    expect(result.success).toBe(false);
  });
});

describe('socket payload schemas', () => {
  it('accepts a well-formed pin-create payload', () => {
    const result = PinCreatePayloadSchema.safeParse({
      mapId: 'map-1',
      pin: { id: 'pin-1', lat: 10, lng: 20, label: 'Here', position: 0 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects pin-create with invalid coordinates', () => {
    const result = PinCreatePayloadSchema.safeParse({
      mapId: 'map-1',
      pin: { id: 'pin-1', lat: 999, lng: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('does not inject default position on pin-update', () => {
    const result = PinUpdatePayloadSchema.safeParse({
      mapId: 'map-1',
      pinId: 'pin-1',
      updates: { label: 'Renamed' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates.position).toBeUndefined();
    }
  });
});

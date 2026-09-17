import { z } from 'zod';

export const MAX_PINS_PER_MAP = 5000;
export const MAX_LAYERS_PER_MAP = 100;

export const PIN_COLOR_NAMES = [
  'red',
  'orange',
  'gold',
  'green',
  'teal',
  'blue',
  'electric_blue',
  'violet',
  'pink',
  'brown',
  'black',
] as const;

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);
export const PinColorSchema = z.union([z.enum(PIN_COLOR_NAMES), HexColorSchema]);

const UuidSchema = z.string().uuid();

export const PinSchema = z.object({
  id: UuidSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(10000).optional().nullable(),
  description: z.string().max(10000).optional().nullable(),
  address: z.string().max(5000).optional().nullable(),
  color: PinColorSchema.optional().nullable(),
  icon: z.string().max(100).optional().nullable(),
  layerId: UuidSchema.optional().nullable(),
  position: z.number().int().nonnegative().optional().default(0),
});

export const LayerSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(1000),
  position: z.number().int().nonnegative().optional().default(0),
});

export const MapCreateSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(1000),
  customColors: z.array(HexColorSchema).max(50).optional(),
  layers: z.array(LayerSchema).max(MAX_LAYERS_PER_MAP).optional(),
  pins: z.array(PinSchema).max(MAX_PINS_PER_MAP).optional(),
});

export const PinCreatePayloadSchema = z.object({
  mapId: UuidSchema,
  layerId: UuidSchema.optional().nullable(),
  pin: PinSchema,
});

export const PinUpdatePayloadSchema = z.object({
  mapId: UuidSchema,
  pinId: UuidSchema,
  updates: z.object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    label: z.string().max(10000).optional().nullable(),
    description: z.string().max(10000).optional().nullable(),
    address: z.string().max(5000).optional().nullable(),
    color: PinColorSchema.optional().nullable(),
    icon: z.string().max(100).optional().nullable(),
    layerId: UuidSchema.optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  }),
});

export const PinDeletePayloadSchema = z.object({
  mapId: UuidSchema,
  pinId: UuidSchema,
});

export const PinsReorderPayloadSchema = z.object({
  mapId: UuidSchema,
  layerId: UuidSchema.optional().nullable(),
  pinIds: z.array(UuidSchema).min(1).max(MAX_PINS_PER_MAP),
  insertIndex: z.number().int().nonnegative(),
});

export const PinMoveLayerPayloadSchema = z.object({
  mapId: UuidSchema,
  pinIds: z.array(UuidSchema).min(1).max(MAX_PINS_PER_MAP),
  targetLayerId: UuidSchema.optional().nullable(),
  destInsertIndex: z.number().int().nonnegative(),
});

export const LayerCreatePayloadSchema = z.object({
  mapId: UuidSchema,
  layer: LayerSchema,
});

export const LayerUpdatePayloadSchema = z.object({
  mapId: UuidSchema,
  layerId: UuidSchema,
  updates: z.object({
    name: z.string().min(1).max(1000).optional(),
    position: z.number().int().nonnegative().optional(),
  }),
});

export const LayerDeletePayloadSchema = z.object({
  mapId: UuidSchema,
  layerId: UuidSchema,
});

export const LayersReorderPayloadSchema = z.object({
  mapId: UuidSchema,
  layerOrder: z.array(UuidSchema).max(MAX_LAYERS_PER_MAP),
});

export const MapNameUpdatePayloadSchema = z.object({
  mapId: UuidSchema,
  name: z.string().min(1).max(1000),
});

export const CustomColorsUpdatePayloadSchema = z.object({
  mapId: UuidSchema,
  customColors: z.array(HexColorSchema).max(50),
});

export const socketPayloadSchemas = {
  'pin-create': PinCreatePayloadSchema,
  'pin-update': PinUpdatePayloadSchema,
  'pin-delete': PinDeletePayloadSchema,
  'pins-reorder': PinsReorderPayloadSchema,
  'pin-move-layer': PinMoveLayerPayloadSchema,
  'layer-create': LayerCreatePayloadSchema,
  'layer-update': LayerUpdatePayloadSchema,
  'layer-delete': LayerDeletePayloadSchema,
  'layers-reorder': LayersReorderPayloadSchema,
  'map-name-update': MapNameUpdatePayloadSchema,
  'custom-colors-update': CustomColorsUpdatePayloadSchema,
} as const;

export const ShareSchema = z.object({
  email: z.string().email(),
  role: z.enum(['view', 'edit', 'owner']),
});

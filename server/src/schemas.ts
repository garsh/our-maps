import { z } from 'zod';

export const MAX_PINS_PER_MAP = 5000;
export const MAX_LAYERS_PER_MAP = 100;

export const PinSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(10000).optional().nullable(),
  description: z.string().max(10000).optional().nullable(),
  address: z.string().max(5000).optional().nullable(),
  color: z.string().max(100).optional().nullable(),
  icon: z.string().max(100).optional().nullable(),
  layerId: z.string().optional().nullable(),
  position: z.number().int().nonnegative().optional().default(0),
});

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(1000),
  position: z.number().int().nonnegative().optional().default(0),
});

export const MapUpdateSchema = z.object({
  name: z.string().min(1).max(1000).optional(),
  customColors: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).max(50).optional(),
  layers: z.array(LayerSchema).max(MAX_LAYERS_PER_MAP).optional(),
  pins: z.array(PinSchema).max(MAX_PINS_PER_MAP).optional(),
});

export const MapCreateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(1000),
  customColors: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).max(50).optional(),
  layers: z.array(LayerSchema).max(MAX_LAYERS_PER_MAP).optional(),
  pins: z.array(PinSchema).max(MAX_PINS_PER_MAP).optional(),
});

export const PinCreatePayloadSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().optional().nullable(),
  pin: PinSchema,
});

export const PinUpdatePayloadSchema = z.object({
  mapId: z.string().min(1),
  pinId: z.string().min(1),
  updates: z.object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    label: z.string().max(10000).optional().nullable(),
    description: z.string().max(10000).optional().nullable(),
    address: z.string().max(5000).optional().nullable(),
    color: z.string().max(100).optional().nullable(),
    icon: z.string().max(100).optional().nullable(),
    layerId: z.string().optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  }),
});

export const PinDeletePayloadSchema = z.object({
  mapId: z.string().min(1),
  pinId: z.string().min(1),
});

export const PinsReorderPayloadSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().optional().nullable(),
  pinOrder: z.array(z.string().min(1)).max(MAX_PINS_PER_MAP),
});

export const PinMoveLayerPayloadSchema = z.object({
  mapId: z.string().min(1),
  pinIds: z.array(z.string().min(1)).min(1).max(MAX_PINS_PER_MAP),
  targetLayerId: z.string().optional().nullable(),
  destPinOrder: z.array(z.string().min(1)).max(MAX_PINS_PER_MAP).optional(),
  sourceLayerId: z.string().optional().nullable(),
  sourcePinOrder: z.array(z.string().min(1)).max(MAX_PINS_PER_MAP).optional(),
});

export const LayerCreatePayloadSchema = z.object({
  mapId: z.string().min(1),
  layer: LayerSchema,
});

export const LayerUpdatePayloadSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().min(1),
  updates: z.object({
    name: z.string().min(1).max(1000).optional(),
    position: z.number().int().nonnegative().optional(),
  }),
});

export const LayerDeletePayloadSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().min(1),
});

export const LayersReorderPayloadSchema = z.object({
  mapId: z.string().min(1),
  layerOrder: z.array(z.string().min(1)).max(MAX_LAYERS_PER_MAP),
});

export const MapNameUpdatePayloadSchema = z.object({
  mapId: z.string().min(1),
  name: z.string().min(1).max(1000),
});

export const CustomColorsUpdatePayloadSchema = z.object({
  mapId: z.string().min(1),
  customColors: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).max(50),
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

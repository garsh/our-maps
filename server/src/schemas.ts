import { z } from 'zod';

export const PinSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(10000).optional().nullable(),
  description: z.string().max(100000).optional().nullable(),
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
  layers: z.array(LayerSchema).optional(),
  pins: z.array(PinSchema).optional(),
});

export const MapCreateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(1000),
  layers: z.array(LayerSchema).optional(),
  pins: z.array(PinSchema).optional(),
});

export const ShareSchema = z.object({
  email: z.string().email(),
  role: z.enum(['view', 'edit', 'owner']),
});

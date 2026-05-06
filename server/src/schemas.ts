import { z } from 'zod';

export const PinSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(255).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  address: z.string().max(1000).optional().nullable(),
  imageUrl: z.string().url().or(z.string().max(0)).optional().nullable(),
  color: z.string().max(50).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  groupId: z.string().optional().nullable(),
  position: z.number().int().nonnegative().optional().default(0),
});

export const GroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  position: z.number().int().nonnegative().optional().default(0),
});

export const MapUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  groups: z.array(GroupSchema).optional(),
  pins: z.array(PinSchema).optional(),
});

export const MapCreateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  groups: z.array(GroupSchema).optional(),
  pins: z.array(PinSchema).optional(),
});

export const ShareSchema = z.object({
  email: z.string().email(),
  role: z.enum(['view', 'edit']),
});

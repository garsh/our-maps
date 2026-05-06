"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShareSchema = exports.MapCreateSchema = exports.MapUpdateSchema = exports.GroupSchema = exports.PinSchema = void 0;
const zod_1 = require("zod");
exports.PinSchema = zod_1.z.object({
    id: zod_1.z.string().uuid().or(zod_1.z.string().min(1)),
    lat: zod_1.z.number().min(-90).max(90),
    lng: zod_1.z.number().min(-180).max(180),
    label: zod_1.z.string().max(255).optional().nullable(),
    description: zod_1.z.string().max(2000).optional().nullable(),
    address: zod_1.z.string().max(1000).optional().nullable(),
    imageUrl: zod_1.z.string().url().or(zod_1.z.string().max(0)).optional().nullable(),
    color: zod_1.z.string().max(50).optional().nullable(),
    icon: zod_1.z.string().max(50).optional().nullable(),
    groupId: zod_1.z.string().optional().nullable(),
    position: zod_1.z.number().int().nonnegative().optional().default(0),
});
exports.GroupSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1).max(255),
    position: zod_1.z.number().int().nonnegative().optional().default(0),
});
exports.MapUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255).optional(),
    groups: zod_1.z.array(exports.GroupSchema).optional(),
    pins: zod_1.z.array(exports.PinSchema).optional(),
});
exports.MapCreateSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1).max(255),
    groups: zod_1.z.array(exports.GroupSchema).optional(),
    pins: zod_1.z.array(exports.PinSchema).optional(),
});
exports.ShareSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    role: zod_1.z.enum(['view', 'edit']),
});

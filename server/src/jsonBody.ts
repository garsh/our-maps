import type { Request, RequestHandler } from 'express';
import express from 'express';

/** Anonymous requests stay at this cap so a caller cannot force a large JSON parse. */
export const defaultJsonParser: RequestHandler = express.json({ limit: '100kb' });

/**
 * Map create and label updates. Attach this only after authMiddleware so an
 * unsigned request is rejected before the body is read.
 */
export const largeJsonParser: RequestHandler = express.json({ limit: '10mb' });

export function defersJsonBody(req: Pick<Request, 'method' | 'path'>): boolean {
  return (
    (req.method === 'POST' && (req.path === '/api/maps' || req.path === '/api/maps/')) ||
    (req.method === 'PUT' && req.path.startsWith('/api/labels'))
  );
}

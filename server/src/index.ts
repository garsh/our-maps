import dotenv from 'dotenv';
import path from 'path';
// Load server/.env first; fall back to the root-level .env (used in dev)
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import fs from 'fs';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { getDb } from './db';
import mapsRouter from './routes/maps';
import placesRouter from './routes/places';
import { googleLoginHandler, filterContactsHandler, searchUsersHandler, authMiddleware } from './auth';
import * as realtime from './realtime';
import type {
  PinCreatePayload,
  PinUpdatePayload,
  PinDeletePayload,
  PinsReorderPayload,
  LayerCreatePayload,
  LayerUpdatePayload,
  LayerDeletePayload,
  LayersReorderPayload,
  MapNameUpdatePayload
} from '@shared/interfaces';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 86400000, // 24 hours
  pingTimeout: 60000,     // 1 minute
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});


const port = process.env.PORT || 3001;

// VERY TOP LEVEL DEBUG LOGGING
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[REQ ${requestId}] ${req.method} ${req.originalUrl} Origin: ${req.headers.origin || 'none'}`);
  console.log(`[REQ ${requestId}] Headers:`, JSON.stringify(req.headers));

  // Intercept response finish to log status
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[RES ${requestId}] ${req.method} ${req.originalUrl} -> STATUS ${res.statusCode} (${duration}ms)`);
    if (res.statusCode >= 400) {
      console.log(`[RES ${requestId}] Headers Sent:`, JSON.stringify(res.getHeaders()));
    }
  });
  next();
});

// Security: Use helmet for secure headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https:", "http:"], 
      "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "https://accounts.google.com/gsi/client", "https://www.gstatic.com"], 
      "style-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "frame-src": ["'self'", "https://accounts.google.com/gsi/"],
      "connect-src": ["'self'", "https:", "http:", "wss:", "ws:", "blob:"],
      "worker-src": ["'self'", "blob:"],
      "child-src": ["'self'", "blob:"],
      "manifest-src": ["'self'"],
      "upgrade-insecure-requests": null, 
    },
  },
  crossOriginEmbedderPolicy: false, 
  crossOriginOpenerPolicy: false, // Disable COOP to ensure Google GSI / postMessage compatibility
}));

// Rate Limiting: Prevent abuse (Brute-force and DoS protection)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => process.env.NODE_ENV === 'test',
});
app.use('/api', apiLimiter);

// CORS: Strict origin validation
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl) or if origin matches
    if (!origin || corsOrigin === '*' || origin === corsOrigin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('192.168.') || origin.includes('.lan')) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// Data limits: allow large map JSON but prevent massive payloads
app.use(express.json({ limit: '10mb' }));

// API Routes
app.post('/api/auth/google-login', googleLoginHandler);
app.post('/api/auth/filter-contacts', authMiddleware, filterContactsHandler);
app.get('/api/auth/search-users', authMiddleware, searchUsersHandler);
app.use('/api/maps', mapsRouter);
app.use('/api/places', placesRouter);

// Socket.io for real-time collaboration
io.on('connection', (socket: Socket) => {
  console.log('[SOCKET] User connected:', socket.id);

  socket.on('join-map', (mapId: string) => {
    socket.join(`map:${mapId}`);
    console.log(`[SOCKET] User ${socket.id} joined map:${mapId}`);
  });

  // Granular Delta Events
  const deltaHandlers: Record<string, (data: any) => Promise<void>> = {
    'pin-create': realtime.handlePinCreate,
    'pin-update': realtime.handlePinUpdate,
    'pin-delete': realtime.handlePinDelete,
    'pins-reorder': realtime.handlePinsReorder,
    'layer-create': realtime.handleLayerCreate,
    'layer-update': realtime.handleLayerUpdate,
    'layer-delete': realtime.handleLayerDelete,
    'layers-reorder': realtime.handleLayersReorder,
    'map-name-update': realtime.handleMapNameUpdate,
  };

  for (const [eventName, handler] of Object.entries(deltaHandlers)) {
    socket.on(eventName, async (data: any) => {
      try {
        await handler(data);
        socket.to(`map:${data.mapId}`).emit(eventName, data);
        console.log(`[SOCKET] ${eventName} on map:${data.mapId} by ${socket.id}`);
      } catch (err) {
        console.error(`[SOCKET] ERROR ${eventName}:`, err);
      }
    });
  }

  socket.on('disconnect', () => {
    console.log('[SOCKET] User disconnected:', socket.id);
  });
});


// Serve maps directory (PMTiles, fonts, sprites) with HTTP Range Request and CORS support
const candidateMapsDirs = [
  process.env.MAPS_DIR,

  // Relative to process.cwd()
  path.resolve(process.cwd(), 'data/maps'),
  path.resolve(process.cwd(), 'data/sprites'),
  path.resolve(process.cwd(), 'data'),
  path.resolve(process.cwd(), 'server/public/maps'),
  path.resolve(process.cwd(), 'server/public/sprites'),
  path.resolve(process.cwd(), 'server/public'),
  path.resolve(process.cwd(), 'public/maps'),
  path.resolve(process.cwd(), 'public/sprites'),
  path.resolve(process.cwd(), 'public'),

  // Relative to __dirname (dev ts-node in src/ vs prod dist/server/src/)
  path.resolve(__dirname, '../../data/maps'),
  path.resolve(__dirname, '../../data/sprites'),
  path.resolve(__dirname, '../../data'),
  path.resolve(__dirname, '../public/maps'),
  path.resolve(__dirname, '../public/sprites'),
  path.resolve(__dirname, '../public'),
  path.resolve(__dirname, '../../../data/maps'),
  path.resolve(__dirname, '../../../data/sprites'),
  path.resolve(__dirname, '../../../data'),
  path.resolve(__dirname, '../../../public/maps'),
  path.resolve(__dirname, '../../../public/sprites'),
  path.resolve(__dirname, '../../../public'),
].filter(Boolean) as string[];

const mapsDir = candidateMapsDirs.find((d) => fs.existsSync(d)) || candidateMapsDirs[0];

console.log(`[MAPS DIR] Serving vector tiles from: ${mapsDir}`);

try {
  if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir, { recursive: true });
  }
} catch (err) {
  console.warn(`[MAPS DIR] Could not create maps directory (${mapsDir}):`, err);
}

const resolvedMapFilePathCache = new Map<string, string>();

function resolveMapFilePath(filename: string): string | null {
  const cached = resolvedMapFilePathCache.get(filename);
  if (cached) return cached;

  for (const dir of candidateMapsDirs) {
    if (!dir) continue;

    // Direct join
    const p = path.join(dir, filename);
    try {
      if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) {
        resolvedMapFilePathCache.set(filename, p);
        return p;
      }
    } catch {
      // Ignore filesystem permission read errors
    }

    // If candidate dir is a sprites dir and request starts with "sprites/"
    if (filename.startsWith('sprites/')) {
      const trimmedFilename = filename.replace(/^sprites\//, '');
      const p2 = path.join(dir, trimmedFilename);
      try {
        if (fs.existsSync(p2) && !fs.statSync(p2).isDirectory()) {
          resolvedMapFilePathCache.set(filename, p2);
          return p2;
        }
      } catch {
        // Ignore
      }
    }
  }

  return null;
}

app.get('/maps/:filename(*)', (req, res, next) => {
  const filename = req.params.filename || 'planet.pmtiles';
  const foundFilePath = resolveMapFilePath(filename);

  if (!foundFilePath) {
    console.warn(`[MAPS 404] Requested file "${filename}" not found in candidate directories:`, candidateMapsDirs);
    return res.status(404).json({ error: `Map file ${filename} not found` });
  }

  try {
    const stat = fs.statSync(foundFilePath);
    const total = stat.size;
    const range = req.headers.range;

    console.log(`[MAPS SERVE] File: ${foundFilePath}, Size: ${total}, Range: ${range || 'none'}`);

    // Set CORS and Expose headers explicitly for every response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    if (foundFilePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    } else if (foundFilePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const partialstart = parts[0];
      const partialend = parts[1];

      const start = parseInt(partialstart, 10);
      const end = partialend ? parseInt(partialend, 10) : total - 1;
      
      if (start >= total || end >= total || start > end) {
        console.warn(`[MAPS 416] Invalid range: ${range} for size ${total}`);
        res.status(416).setHeader('Content-Range', `bytes */${total}`);
        return res.end();
      }

      const chunksize = (end - start) + 1;
      console.log(`[MAPS 206] Sending range: ${start}-${end} (${chunksize} bytes)`);

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', chunksize);

      if (req.method === 'HEAD') return res.end();

      const stream = fs.createReadStream(foundFilePath, { start, end });
      stream.on('open', () => stream.pipe(res));
      stream.on('error', (streamErr) => {
        console.error(`[MAPS STREAM ERROR]`, streamErr);
        if (!res.headersSent) res.status(500).end('Stream error');
      });
    } else {
      console.log(`[MAPS 200] Sending full file: ${total} bytes`);
      res.setHeader('Content-Length', total);
      res.status(200);
      
      if (req.method === 'HEAD') return res.end();

      const stream = fs.createReadStream(foundFilePath);
      stream.on('open', () => stream.pipe(res));
      stream.on('error', (streamErr) => {
        console.error(`[MAPS STREAM ERROR]`, streamErr);
        if (!res.headersSent) res.status(500).end('Stream error');
      });
    }
  } catch (err) {
    console.error(`[MAPS ERROR] Failed to process ${foundFilePath}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error processing map file' });
    }
  }
});

// Resolve client build path
const potentialPaths = [
  path.join(__dirname, '../../../../client/dist'), 
  path.join(__dirname, '../../client/dist'),      
  path.join(process.cwd(), '../client/dist'),     
  path.join(process.cwd(), 'client/dist')         
];

const clientBuildPath = potentialPaths.find(p => fs.existsSync(p)) || potentialPaths[0];
app.use(express.static(clientBuildPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js') || filePath.endsWith('registerSW.js') || filePath.endsWith('index.html') || filePath.endsWith('manifest.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.get('*', (req, res) => {
  const isApiOrMaps = req.path.startsWith('/api') || req.path.startsWith('/maps');
  const isStaticAsset = req.path.startsWith('/assets/') || /\.(js|css|json|png|jpg|jpeg|gif|ico|svg|wasm|pbf|pmtiles|map|webmanifest)$/i.test(req.path);

  if (!isApiOrMaps && !isStaticAsset) {
    const indexPath = path.join(clientBuildPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Frontend not found');
    }
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
});

// DB is initialized on demand

export { app };

if (process.env.NODE_ENV !== 'test') {
  server.listen(port as number, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
  });
}

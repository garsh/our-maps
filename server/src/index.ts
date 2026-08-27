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
import mapsRouter from './routes/maps';
import type { User } from '@shared/interfaces';
import placesRouter from './routes/places';
import { googleLoginHandler, filterContactsHandler, searchUsersHandler, authMiddleware, authenticateToken, getJwtSecret } from './auth';
import { getMapRole, canEditMap, canViewMap } from './permissions';
import { resolveSafeMapFile, getSafeFontDownloadTarget, sanitizeMapFilename } from './mapFiles';
import { isAllowedOrigin } from './cors';
import { getCspDirectives } from './csp';
import * as realtime from './realtime';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 60000, // 1 minute
  pingTimeout: 20000,  // 20 seconds
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST']
  }
});
app.set('io', io);


const port = process.env.PORT || 3001;

// Security: Use helmet for secure headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: getCspDirectives(),
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

// CORS: exact origin match (comma-separated CORS_ORIGIN) plus LAN/dev hosts
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
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

function getSocketToken(socket: Socket): string | undefined {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken) return authToken;
  const header = socket.handshake.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }
  return undefined;
}

function getAuthedUser(socket: Socket): User {
  return socket.data.user as User;
}

io.use(async (socket, next) => {
  try {
    const user = await authenticateToken(getSocketToken(socket));
    socket.data.user = user as User;
    next();
  } catch {
    next(new Error('Authentication failed'));
  }
});

// Socket.io for real-time collaboration
io.on('connection', (socket: Socket) => {
  console.log('[SOCKET] User connected:', socket.id);

  socket.on('join-map', async (mapId: string) => {
    if (typeof mapId !== 'string' || !mapId) return;
    const role = await getMapRole(getAuthedUser(socket).id, mapId);
    if (!canViewMap(role)) {
      socket.emit('join-map-error', { mapId, error: 'Access denied' });
      return;
    }
    socket.join(`map:${mapId}`);
    console.log(`[SOCKET] User ${socket.id} joined map:${mapId}`);
  });

  // Granular Delta Events
  const deltaHandlers: Record<string, (data: any) => Promise<boolean | void>> = {
    'pin-create': realtime.handlePinCreate,
    'pin-update': realtime.handlePinUpdate,
    'pin-delete': realtime.handlePinDelete,
    'pins-reorder': realtime.handlePinsReorder,
    'pin-move-layer': realtime.handlePinMoveLayer,
    'layer-create': realtime.handleLayerCreate,
    'layer-update': realtime.handleLayerUpdate,
    'layer-delete': realtime.handleLayerDelete,
    'layers-reorder': realtime.handleLayersReorder,
    'map-name-update': realtime.handleMapNameUpdate,
  };

  for (const [eventName, handler] of Object.entries(deltaHandlers)) {
    socket.on(eventName, async (data: any) => {
      try {
        const mapId = data?.mapId;
        if (typeof mapId !== 'string' || !mapId) return;

        const role = await getMapRole(getAuthedUser(socket).id, mapId);
        if (!canEditMap(role)) {
          socket.emit('write-error', { mapId, error: 'Write access denied' });
          return;
        }

        const applied = await handler(data);
        if (applied === false) return;

        socket.to(`map:${mapId}`).emit(eventName, data);
        console.log(`[SOCKET] ${eventName} on map:${mapId} by ${socket.id}`);
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
  path.resolve(process.cwd(), 'data/fonts'),
  path.resolve(process.cwd(), 'data'),
  path.resolve(process.cwd(), 'server/public/maps'),
  path.resolve(process.cwd(), 'server/public/sprites'),
  path.resolve(process.cwd(), 'server/public/fonts'),
  path.resolve(process.cwd(), 'server/public'),
  path.resolve(process.cwd(), 'public/maps'),
  path.resolve(process.cwd(), 'public/sprites'),
  path.resolve(process.cwd(), 'public/fonts'),
  path.resolve(process.cwd(), 'public'),

  // Relative to __dirname (dev ts-node in src/ vs prod dist/server/src/)
  path.resolve(__dirname, '../../data/maps'),
  path.resolve(__dirname, '../../data/sprites'),
  path.resolve(__dirname, '../../data/fonts'),
  path.resolve(__dirname, '../../data'),
  path.resolve(__dirname, '../public/maps'),
  path.resolve(__dirname, '../public/sprites'),
  path.resolve(__dirname, '../public/fonts'),
  path.resolve(__dirname, '../public'),
  path.resolve(__dirname, '../../../data/maps'),
  path.resolve(__dirname, '../../../data/sprites'),
  path.resolve(__dirname, '../../../data/fonts'),
  path.resolve(__dirname, '../../../data'),
  path.resolve(__dirname, '../../../public/maps'),
  path.resolve(__dirname, '../../../public/sprites'),
  path.resolve(__dirname, '../../../public/fonts'),
  path.resolve(__dirname, '../../../public'),
].filter(Boolean) as string[];

const mapsDir = candidateMapsDirs.find((d) => fs.existsSync(d)) || candidateMapsDirs[0];

if (process.env.NODE_ENV !== 'test') {
  console.log(`[MAPS DIR] Serving vector tiles from: ${mapsDir}`);
}

try {
  if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir, { recursive: true });
  }
} catch (err) {
  if (process.env.NODE_ENV !== 'test') {
    console.warn(`[MAPS DIR] Could not create maps directory (${mapsDir}):`, err);
  }
}

app.get('/maps/:filename(*)', async (req, res, next) => {
  const filename = req.params.filename || 'planet.pmtiles';
  const sanitizedName = sanitizeMapFilename(filename);
  let foundFilePath = resolveSafeMapFile(filename, candidateMapsDirs);

  // On-demand font download fallback if font file not yet on disk
  if (!foundFilePath && sanitizedName && sanitizedName.startsWith('fonts/') && sanitizedName.endsWith('.pbf')) {
    try {
      const safeTarget = getSafeFontDownloadTarget(sanitizedName, path.resolve(process.cwd(), 'data'));
      if (safeTarget) {
        const upstreamUrl = `https://protomaps.github.io/basemaps-assets/${sanitizedName.split('/').map(encodeURIComponent).join('/')}`;
        if (!fs.existsSync(safeTarget.targetDir)) {
          fs.mkdirSync(safeTarget.targetDir, { recursive: true });
        }
        const response = await fetch(upstreamUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          fs.writeFileSync(safeTarget.targetPath, buffer);
          foundFilePath = resolveSafeMapFile(sanitizedName, candidateMapsDirs) || safeTarget.targetPath;
        }
      }
    } catch (fetchErr) {
      console.warn('[MAPS FONTS FETCH] Failed to fetch on-demand font:', fetchErr);
    }
  }

  if (!foundFilePath) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[MAPS 404] Requested map file not found');
    }
    return res.status(404).json({ error: 'Map file not found' });
  }

  try {
    const stat = fs.statSync(foundFilePath);
    const total = stat.size;
    const range = req.headers.range;

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
    } else if (foundFilePath.endsWith('.pbf')) {
      res.setHeader('Content-Type', 'application/x-protobuf');
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
  getJwtSecret();
  server.listen(port as number, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
  });
}

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

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Our Maps Server!' });
});

// Socket.io for real-time collaboration
io.on('connection', (socket: Socket) => {
  console.log('[SOCKET] User connected:', socket.id);

  socket.on('join-map', (mapId: string) => {
    socket.join(`map:${mapId}`);
    console.log(`[SOCKET] User ${socket.id} joined map:${mapId}`);
  });

  // Granular Delta Events
  socket.on('pin-create', async (data: PinCreatePayload) => {
    try {
      await realtime.handlePinCreate(data);
      socket.to(`map:${data.mapId}`).emit('pin-create', data);
      console.log(`[SOCKET] pin-create on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR pin-create:`, err);
    }
  });

  socket.on('pin-update', async (data: PinUpdatePayload) => {
    try {
      await realtime.handlePinUpdate(data);
      socket.to(`map:${data.mapId}`).emit('pin-update', data);
      console.log(`[SOCKET] pin-update on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR pin-update:`, err);
    }
  });

  socket.on('pin-delete', async (data: PinDeletePayload) => {
    try {
      await realtime.handlePinDelete(data);
      socket.to(`map:${data.mapId}`).emit('pin-delete', data);
      console.log(`[SOCKET] pin-delete on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR pin-delete:`, err);
    }
  });

  socket.on('pins-reorder', async (data: PinsReorderPayload) => {
    try {
      await realtime.handlePinsReorder(data);
      socket.to(`map:${data.mapId}`).emit('pins-reorder', data);
      console.log(`[SOCKET] pins-reorder on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR pins-reorder:`, err);
    }
  });

  socket.on('layer-create', async (data: LayerCreatePayload) => {
    try {
      await realtime.handleLayerCreate(data);
      socket.to(`map:${data.mapId}`).emit('layer-create', data);
      console.log(`[SOCKET] layer-create on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR layer-create:`, err);
    }
  });

  socket.on('layer-update', async (data: LayerUpdatePayload) => {
    try {
      await realtime.handleLayerUpdate(data);
      socket.to(`map:${data.mapId}`).emit('layer-update', data);
      console.log(`[SOCKET] layer-update on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR layer-update:`, err);
    }
  });

  socket.on('layer-delete', async (data: LayerDeletePayload) => {
    try {
      await realtime.handleLayerDelete(data);
      socket.to(`map:${data.mapId}`).emit('layer-delete', data);
      console.log(`[SOCKET] layer-delete on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR layer-delete:`, err);
    }
  });

  socket.on('layers-reorder', async (data: LayersReorderPayload) => {
    try {
      await realtime.handleLayersReorder(data);
      socket.to(`map:${data.mapId}`).emit('layers-reorder', data);
      console.log(`[SOCKET] layers-reorder on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR layers-reorder:`, err);
    }
  });

  socket.on('map-name-update', async (data: MapNameUpdatePayload) => {
    try {
      await realtime.handleMapNameUpdate(data);
      socket.to(`map:${data.mapId}`).emit('map-name-update', data);
      console.log(`[SOCKET] map-name-update on map:${data.mapId} by ${socket.id}`);
    } catch (err) {
      console.error(`[SOCKET] ERROR map-name-update:`, err);
    }
  });

  // Legacy snapshot event for backward compatibility
  socket.on('map-updated', (data: { mapId: string, pins?: any[], layers?: any[], name: string }) => {
    const safePayload = {
      mapId: data.mapId,
      name: data.name || 'Unnamed Map',
      pins: Array.isArray(data.pins) ? data.pins : [],
      layers: Array.isArray(data.layers) ? data.layers : []
    };
    
    socket.to(`map:${data.mapId}`).emit('map-remote-updated', safePayload);
    console.log(`[SOCKET] Map ${data.mapId} updated by ${socket.id} (Pins: ${safePayload.pins.length})`);
  });

  socket.on('disconnect', () => {
    console.log('[SOCKET] User disconnected:', socket.id);
  });
});


// Serve maps directory (PMTiles, fonts, sprites) with HTTP Range Request and CORS support
const candidateMapsDirs = [
  process.env.MAPS_DIR,
  path.resolve(process.cwd(), 'data/maps'),
  path.resolve(process.cwd(), 'server/public/maps'),
  path.resolve(process.cwd(), 'public/maps'),
  path.resolve(__dirname, '../../data/maps'),
  path.resolve(__dirname, '../public/maps'),
  path.resolve(__dirname, '../../public/maps'),
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

app.use('/maps', (req, res, next) => {
  console.log(`[MAPS REQ] ${req.method} ${req.url} (Range: ${req.headers.range || 'none'})`);
  next();
});

const staticOptions = {
  acceptRanges: true,
  setHeaders: (res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  }
};
candidateMapsDirs.forEach((dir) => {
  if (fs.existsSync(dir)) {
    app.use('/maps', express.static(dir, staticOptions));
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
app.use(express.static(clientBuildPath));

app.get('*', (req, res) => {
  const isApiOrMaps = req.path.startsWith('/api') || req.path.startsWith('/maps');
  const isStaticAsset = req.path.startsWith('/assets/') || /\.(js|css|json|png|jpg|jpeg|gif|ico|svg|wasm|pbf|pmtiles|map|webmanifest)$/i.test(req.path);

  if (!isApiOrMaps && !isStaticAsset) {
    const indexPath = path.join(clientBuildPath, 'index.html');
    if (fs.existsSync(indexPath)) {
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

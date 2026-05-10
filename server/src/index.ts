import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { getDb } from './db';
import mapsRouter from './routes/maps';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
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
      "connect-src": ["'self'", "https:", "http:", "wss:", "ws:"],
      "worker-src": ["'self'", "blob:"],
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
    if (!origin || corsOrigin === '*' || origin === corsOrigin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('192.168.')) {
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
app.use('/api/maps', mapsRouter);

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

  socket.on('map-updated', (data: { mapId: string, pins: any[], groups: any[], name: string }) => {
    // Broadcast update to everyone else in the map room
    socket.to(`map:${data.mapId}`).emit('map-remote-updated', data);
    console.log(`[SOCKET] Map ${data.mapId} updated by ${socket.id}`);
  });

  socket.on('disconnect', () => {
    console.log('[SOCKET] User disconnected:', socket.id);
  });
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
  if (!req.url.startsWith('/api')) {
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

// Initialize DB
getDb().then(() => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('Database initialized');
  }
}).catch(err => {
  console.error('Failed to initialize database:', err);
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  server.listen(port as number, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
  });
}

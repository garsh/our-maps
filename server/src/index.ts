import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { getDb } from './db';
import mapsRouter from './routes/maps';

const app = express();
const port = process.env.PORT || 3001;

// Security: Use helmet for secure headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https:", "http:"], // Allow images from map providers
      "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "https://accounts.google.com/gsi/client"], 
      "style-src": ["'self'", "'unsafe-inline'"],
      "frame-src": ["'self'", "https://accounts.google.com/gsi/"],
      "connect-src": ["'self'", "https://*.openstreetmap.org", "https://*.tile.openstreetmap.org", "https://nominatim.openstreetmap.org", "https://accounts.google.com/gsi/"],
      "worker-src": ["'self'", "blob:"],
      "manifest-src": ["'self'"],
      "upgrade-insecure-requests": null, // Disable auto-upgrade to support local http dev
    },
  },
  crossOriginEmbedderPolicy: false, // Disable to allow cross-origin images/scripts
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // Allow Google Login popups
}));

// Rate Limiting: Prevent abuse (Brute-force and DoS protection)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // stricter limit for API
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => process.env.NODE_ENV === 'test',
});
app.use('/api/', apiLimiter);

// CORS: Strict origin validation
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl) or if origin matches
    if (!origin || corsOrigin === '*' || origin === corsOrigin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
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

// Resolve client build path (handle both dev and prod folder structures)
const potentialPaths = [
  path.join(__dirname, '../../../../client/dist'), // Production (server/dist/server/src)
  path.join(__dirname, '../../client/dist'),      // Development (server/src)
  path.join(process.cwd(), '../client/dist'),     // Process root
  path.join(process.cwd(), 'client/dist')         // Repo root
];

const clientBuildPath = potentialPaths.find(p => fs.existsSync(p)) || potentialPaths[0];

app.use(express.static(clientBuildPath));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
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

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Initialize DB before starting server
getDb().then(() => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('Database initialized');
  }
}).catch(err => {
  console.error('Failed to initialize database:', err);
});

// Export app for testing
export { app };

// Only listen if not in test mode
if (process.env.NODE_ENV !== 'test') {
  app.listen(port as number, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
    console.log(`Access locally at http://localhost:${port}`);
  });
}

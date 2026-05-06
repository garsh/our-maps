"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("./db");
const maps_1 = __importDefault(require("./routes/maps"));
const app = (0, express_1.default)();
exports.app = app;
const port = process.env.PORT || 3001;
// Security: Use helmet for secure headers
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            ...helmet_1.default.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "data:", "https:", "http:"],
            "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "https://accounts.google.com/gsi/client", "https://www.gstatic.com"],
            "style-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "frame-src": ["'self'", "https://accounts.google.com/gsi/"],
            "connect-src": ["'self'", "https://*.openstreetmap.org", "https://*.tile.openstreetmap.org", "https://nominatim.openstreetmap.org", "https://accounts.google.com/gsi/"],
            "worker-src": ["'self'", "blob:"],
            "manifest-src": ["'self'"],
            "upgrade-insecure-requests": null,
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));
// Rate Limiting: Prevent abuse (Brute-force and DoS protection)
const apiLimiter = (0, express_rate_limit_1.default)({
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
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl) or if origin matches
        if (!origin || corsOrigin === '*' || origin === corsOrigin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
}));
// Data limits: allow large map JSON but prevent massive payloads
app.use(express_1.default.json({ limit: '10mb' }));
// API Routes
app.use('/api/maps', maps_1.default);
app.get('/api/hello', (req, res) => {
    res.json({ message: 'Hello from Our Maps Server!' });
});
// Resolve client build path (handle both dev and prod folder structures)
const potentialPaths = [
    path_1.default.join(__dirname, '../../../../client/dist'), // Production (server/dist/server/src)
    path_1.default.join(__dirname, '../../client/dist'), // Development (server/src)
    path_1.default.join(process.cwd(), '../client/dist'), // Process root
    path_1.default.join(process.cwd(), 'client/dist') // Repo root
];
const clientBuildPath = potentialPaths.find(p => fs_1.default.existsSync(p)) || potentialPaths[0];
app.use(express_1.default.static(clientBuildPath));
// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
    if (!req.url.startsWith('/api')) {
        const indexPath = path_1.default.join(clientBuildPath, 'index.html');
        if (fs_1.default.existsSync(indexPath)) {
            res.sendFile(indexPath);
        }
        else {
            res.status(404).send('Frontend not found');
        }
    }
    else {
        res.status(404).json({ error: 'Not Found' });
    }
});
// Global error handler
app.use((err, _req, res, _next) => {
    console.error('[SERVER ERROR]', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});
// Initialize DB before starting server
(0, db_1.getDb)().then(() => {
    if (process.env.NODE_ENV !== 'test') {
        console.log('Database initialized');
    }
}).catch(err => {
    console.error('Failed to initialize database:', err);
});
// Only listen if not in test mode
if (process.env.NODE_ENV !== 'test') {
    app.listen(port, '0.0.0.0', () => {
        console.log(`Server is running on http://0.0.0.0:${port}`);
        console.log(`Access locally at http://localhost:${port}`);
    });
}

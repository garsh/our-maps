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
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const db_1 = require("./db");
const maps_1 = __importDefault(require("./routes/maps"));
const auth_1 = require("./auth");
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST']
    }
});
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
const apiLimiter = (0, express_rate_limit_1.default)({
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
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl) or if origin matches
        if (!origin || corsOrigin === '*' || origin === corsOrigin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('192.168.')) {
            callback(null, true);
        }
        else {
            callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
}));
// Data limits: allow large map JSON but prevent massive payloads
app.use(express_1.default.json({ limit: '10mb' }));
// API Routes
app.post('/api/auth/google-login', auth_1.googleLoginHandler);
app.use('/api/maps', maps_1.default);
app.get('/api/hello', (req, res) => {
    res.json({ message: 'Hello from Our Maps Server!' });
});
// Socket.io for real-time collaboration
io.on('connection', (socket) => {
    console.log('[SOCKET] User connected:', socket.id);
    socket.on('join-map', (mapId) => {
        socket.join(`map:${mapId}`);
        console.log(`[SOCKET] User ${socket.id} joined map:${mapId}`);
    });
    socket.on('map-updated', (data) => {
        // Sanitize and validate before broadcasting
        const safePayload = {
            mapId: data.mapId,
            name: data.name || 'Unnamed Map',
            pins: Array.isArray(data.pins) ? data.pins : [],
            groups: Array.isArray(data.groups) ? data.groups : []
        };
        // Broadcast update to everyone else in the map room
        socket.to(`map:${data.mapId}`).emit('map-remote-updated', safePayload);
        console.log(`[SOCKET] Map ${data.mapId} updated by ${socket.id} (Pins: ${safePayload.pins.length})`);
    });
    socket.on('disconnect', () => {
        console.log('[SOCKET] User disconnected:', socket.id);
    });
});
// Resolve client build path
const potentialPaths = [
    path_1.default.join(__dirname, '../../../../client/dist'),
    path_1.default.join(__dirname, '../../client/dist'),
    path_1.default.join(process.cwd(), '../client/dist'),
    path_1.default.join(process.cwd(), 'client/dist')
];
const clientBuildPath = potentialPaths.find(p => fs_1.default.existsSync(p)) || potentialPaths[0];
app.use(express_1.default.static(clientBuildPath));
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
// Initialize DB
(0, db_1.getDb)().then(() => {
    if (process.env.NODE_ENV !== 'test') {
        console.log('Database initialized');
    }
}).catch(err => {
    console.error('Failed to initialize database:', err);
});
if (process.env.NODE_ENV !== 'test') {
    server.listen(port, '0.0.0.0', () => {
        console.log(`Server is running on http://0.0.0.0:${port}`);
    });
}

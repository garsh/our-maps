"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const db_1 = require("./db");
const maps_1 = __importDefault(require("./routes/maps"));
const app = (0, express_1.default)();
exports.app = app;
const port = process.env.PORT || 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// API Routes
app.use('/api/maps', maps_1.default);
app.get('/api/hello', (req, res) => {
    res.json({ message: 'Hello from Our Maps Server!' });
});
// Serve static files from the React app production build
const clientBuildPath = path_1.default.join(__dirname, '../../../../client/dist');
app.use(express_1.default.static(clientBuildPath));
// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
    if (!req.url.startsWith('/api')) {
        res.sendFile(path_1.default.join(clientBuildPath, 'index.html'));
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

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const maps_1 = __importDefault(require("./routes/maps"));
const app = (0, express_1.default)();
exports.app = app;
const port = process.env.PORT || 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/api/maps', maps_1.default);
app.get('/api/hello', (req, res) => {
    res.json({ message: 'Hello from Our Maps Server!' });
});
// Initialize DB before starting server
(0, db_1.getDb)().then(() => {
    if (process.env.NODE_ENV !== 'test') {
        console.log('Database initialized');
    }
});
// Only listen if not in test mode
if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
    });
}

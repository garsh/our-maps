"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const google_auth_library_1 = require("google-auth-library");
const db_1 = require("./db");
const client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    const mockUserHeader = req.headers['x-mock-user'];
    // SUPPORT MOCK USER FOR DEVELOPMENT
    if (process.env.NODE_ENV !== 'production' && mockUserHeader) {
        try {
            const mockUser = JSON.parse(mockUserHeader);
            req.user = mockUser;
            await ensureUserExists(mockUser);
            return next();
        }
        catch (e) {
            return res.status(400).json({ error: 'Invalid mock user header' });
        }
    }
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        // If it looks like a mock token (no dots) and we're not in production, try to decode it first
        if (!token.includes('.') && process.env.NODE_ENV !== 'production') {
            try {
                const decoded = Buffer.from(token, 'base64').toString();
                console.log('[AUTH] Raw token:', token);
                console.log('[AUTH] Decoded string:', decoded);
                const user = JSON.parse(decoded);
                req.user = user;
                await ensureUserExists(user);
                return next();
            }
            catch (e) {
                // Fall through to real verification if it wasn't a valid mock token after all
            }
        }
        // If GOOGLE_CLIENT_ID is set, we MUST verify the token via Google
        if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'MOCK_CLIENT_ID') {
            const ticket = await client.verifyIdToken({
                idToken: token,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            if (!payload || !payload.sub || !payload.email) {
                return res.status(401).json({ error: 'Invalid token payload' });
            }
            const user = {
                id: payload.sub,
                email: payload.email,
                name: payload.name || payload.email,
                picture: payload.picture
            };
            req.user = user;
            await ensureUserExists(user);
            return next();
        }
        // Fallback to SIMULATED OAUTH if no Client ID is set (DEV ONLY)
        try {
            let user;
            if (token.includes('.')) {
                // It's likely a JWT. Extract the payload (2nd part).
                const payload = token.split('.')[1];
                const decoded = Buffer.from(payload, 'base64').toString('utf8');
                user = JSON.parse(decoded);
                // Map JWT sub to id if needed
                if (!user.id && user.sub)
                    user.id = user.sub;
            }
            else {
                // It's a simple base64 mock token
                const decoded = Buffer.from(token, 'base64').toString('utf8');
                user = JSON.parse(decoded);
            }
            req.user = user;
            await ensureUserExists(user);
            return next();
        }
        catch (e) {
            console.error('Failed to decode mock token:', e);
            res.status(401).json({ error: 'Invalid mock token or missing GOOGLE_CLIENT_ID on server' });
        }
    }
    catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
}
async function ensureUserExists(user) {
    const db = await (0, db_1.getDb)();
    await db.run('INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, picture=excluded.picture', user.id, user.email, user.name, user.picture);
}

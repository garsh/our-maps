import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { getDb } from './db';
import type { User } from '@shared/interfaces';

// Helper to get clean Client ID
const getGoogleClientId = () => {
    const id = process.env.GOOGLE_CLIENT_ID;
    if (!id || id === 'MOCK_CLIENT_ID') return null;
    return id.replace(/^["'](.+)["']$/, '$1'); // Remove surrounding quotes
};

const client = new OAuth2Client(getGoogleClientId() || undefined);

export interface AuthRequest extends Request {
  user?: User;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const mockUserHeader = req.headers['x-mock-user'];
  const googleClientId = getGoogleClientId();
  
  // SUPPORT MOCK USER FOR DEVELOPMENT
  if (process.env.NODE_ENV !== 'production' && mockUserHeader) {
    try {
      const mockUser = JSON.parse(mockUserHeader as string);
      req.user = mockUser;
      await ensureUserExists(mockUser);
      return next();
    } catch (e) {
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
        const user = JSON.parse(decoded);
        req.user = user;
        await ensureUserExists(user);
        return next();
      } catch (e) {
        // Fall through
      }
    }

    // If GOOGLE_CLIENT_ID is set, we MUST verify the token via Google
    if (googleClientId) {
      try {
        const ticket = await client.verifyIdToken({
          idToken: token,
          audience: googleClientId,
        });
        
        const payload = ticket.getPayload();
        if (!payload || !payload.sub || !payload.email) {
          return res.status(401).json({ error: 'Invalid token payload' });
        }

        const user: User = {
          id: payload.sub,
          email: payload.email,
          name: payload.name || payload.email,
          picture: payload.picture
        };

        req.user = user;
        await ensureUserExists(user);
        return next();
      } catch (e: any) {
        return res.status(401).json({ error: `Authentication failed: ${e.message}` });
      }
    }

    // Fallback to SIMULATED OAUTH if no Client ID is set (DEV ONLY)
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Authentication required: Server configuration error' });
    }

    try {
      let user;
      if (token.includes('.')) {
         // It's likely a JWT. Extract the payload (2nd part).
         const payload = token.split('.')[1];
         const decoded = Buffer.from(payload, 'base64').toString('utf8');
         user = JSON.parse(decoded);
         // Map JWT sub to id if needed
         if (!user.id && user.sub) user.id = user.sub;
      } else {
         // It's a simple base64 mock token
         const decoded = Buffer.from(token, 'base64').toString('utf8');
         user = JSON.parse(decoded);
      }
      
      req.user = user;
      await ensureUserExists(user);
      return next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid mock token or missing GOOGLE_CLIENT_ID on server' });
    }
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

async function ensureUserExists(user: User) {
  const db = await getDb();
  await db.run(
    'INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, picture=excluded.picture',
    user.id, user.email, user.name, user.picture
  );
}

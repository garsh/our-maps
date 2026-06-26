import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { getDb } from './db';
import type { User } from '@shared/interfaces';

const JWT_SECRET = process.env.JWT_SECRET || 'our-maps-dev-secret-key-30-days';

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

export async function googleLoginHandler(req: Request, res: Response) {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Credential is required' });
  }

  const googleClientId = getGoogleClientId();
  if (!googleClientId) {
    return res.status(500).json({ error: 'Server not configured for Google Auth' });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
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

    await ensureUserExists(user);

    // Sign a custom JWT valid for 30 days
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({ token, user });
  } catch (e: any) {
    console.error('[AUTH] Google login failed:', e);
    return res.status(401).json({ error: `Authentication failed: ${e.message}` });
  }
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const mockUserHeader = req.headers['x-mock-user'];
  
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

    // Verify custom JWT
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (!decoded || !decoded.sub || !decoded.email) {
        return res.status(401).json({ error: 'Invalid token payload' });
      }

      const user: User = {
        id: decoded.sub,
        email: decoded.email,
        name: decoded.name || decoded.email,
        picture: decoded.picture
      };

      req.user = user;
      await ensureUserExists(user);
      return next();
    } catch (jwtErr: any) {
      // Fallback for development if signature verification failed
      if (process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: `Authentication failed: ${jwtErr.message}` });
      }

      try {
        let user;
        if (token.includes('.')) {
           const payload = token.split('.')[1];
           const decoded = Buffer.from(payload, 'base64').toString('utf8');
           user = JSON.parse(decoded);
           if (!user.id && user.sub) user.id = user.sub;
        } else {
           const decoded = Buffer.from(token, 'base64').toString('utf8');
           user = JSON.parse(decoded);
        }
        
        req.user = user;
        await ensureUserExists(user);
        return next();
      } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
      }
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

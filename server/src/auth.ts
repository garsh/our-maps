import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from './db';
import type { User } from '@shared/interfaces';

export const SESSION_COOKIE = 'ourmaps_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const DEV_JWT_SECRET = 'our-maps-dev-secret-key-30-days';

export function isMockAuthAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret === DEV_JWT_SECRET) {
      throw new Error('JWT_SECRET must be set to a unique non-default value when NODE_ENV=production');
    }
    return secret;
  }
  return secret || DEV_JWT_SECRET;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function isValidUser(user: any): user is User {
  return Boolean(user && typeof user.id === 'string' && user.id && typeof user.email === 'string' && user.email);
}

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

export function setSessionCookie(res: Response, sessionId: string) {
  res.cookie(SESSION_COOKIE, sessionId, sessionCookieOptions());
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export async function createSession(userId: string): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
  await db.run(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    id,
    userId,
    expiresAt
  );
  return id;
}

export async function getUserForSession(sessionId: string): Promise<User> {
  const db = await getDb();
  const row = await db.get(
    `SELECT s.expires_at, u.id as user_id, u.email, u.name, u.picture
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    sessionId
  );
  if (!row) {
    throw new AuthError('No token provided');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.run('DELETE FROM sessions WHERE id = ?', sessionId);
    throw new AuthError('Session expired');
  }
  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    picture: row.picture
  };
}

export async function deleteSession(sessionId: string) {
  const db = await getDb();
  await db.run('DELETE FROM sessions WHERE id = ?', sessionId);
}

export async function deleteAllSessionsForUser(userId: string) {
  const db = await getDb();
  await db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export async function authenticateRequest(req: Request): Promise<User> {
  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sessionId) {
    try {
      return await getUserForSession(sessionId);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
    }
  }

  const authHeader = req.headers.authorization;
  const mockUserHeader = req.headers['x-mock-user'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
  return authenticateToken(token, mockUserHeader as string | undefined);
}

export async function authenticateToken(
  token: string | undefined | null,
  mockUserHeader?: string
): Promise<User> {
  if (isMockAuthAllowed() && mockUserHeader) {
    try {
      const mockUser = JSON.parse(mockUserHeader);
      if (!isValidUser(mockUser)) {
        throw new Error('invalid mock user');
      }
      await ensureUserExists(mockUser);
      return mockUser;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError('Invalid mock user header', 400);
    }
  }

  if (!token) {
    throw new AuthError('No token provided');
  }

  if (!token.includes('.') && isMockAuthAllowed()) {
    try {
      const user = JSON.parse(Buffer.from(token, 'base64').toString());
      if (isValidUser(user)) {
        await ensureUserExists(user);
        return user;
      }
    } catch {
      // Fall through to JWT verification
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new AuthError('Session required');
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (!decoded || !decoded.sub || !decoded.email) {
      throw new AuthError('Invalid token payload');
    }

    const user: User = {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded.email,
      picture: decoded.picture
    };

    await ensureUserExists(user);
    return user;
  } catch (jwtErr: any) {
    if (jwtErr instanceof AuthError) throw jwtErr;

    if (!isMockAuthAllowed()) {
      throw new AuthError(`Authentication failed: ${jwtErr.message}`);
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

      if (!isValidUser(user)) {
        throw new Error('invalid token');
      }

      await ensureUserExists(user);
      return user;
    } catch {
      throw new AuthError('Invalid token');
    }
  }
}

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
    
    const user = userFromGooglePayload(ticket.getPayload());
    await ensureUserExists(user);
    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);
    return res.json({ user });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('[AUTH] Google login failed:', e);
    return res.status(401).json({ error: `Authentication failed: ${e.message}` });
  }
}

export function userFromGooglePayload(payload: {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
} | undefined): User {
  if (!payload || !payload.sub || !payload.email) {
    throw new AuthError('Invalid token payload');
  }
  if (payload.email_verified !== true) {
    throw new AuthError('Verify this email with Google, then sign in again.');
  }
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture
  };
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    req.user = await authenticateRequest(req);
    return next();
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

export async function meHandler(req: Request, res: Response) {
  try {
    const user = await authenticateRequest(req);
    return res.json({ user });
  } catch {
    return res.json({ user: null });
  }
}

export async function mockLoginHandler(_req: Request, res: Response) {
  if (!isMockAuthAllowed()) {
    return res.status(404).json({ error: 'Not Found' });
  }
  const mockUser: User = {
    id: 'mock-user-id',
    email: 'mock@example.com',
    name: 'Mock User',
    picture: ''
  };
  await ensureUserExists(mockUser);
  const sessionId = await createSession(mockUser.id);
  setSessionCookie(res, sessionId);
  return res.json({ user: mockUser });
}

export async function logoutHandler(req: Request, res: Response) {
  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sessionId) {
    await deleteSession(sessionId);
  }
  clearSessionCookie(res);
  return res.json({ message: 'Signed out' });
}

export async function logoutEverywhereHandler(req: AuthRequest, res: Response) {
  if (req.user?.id) {
    await deleteAllSessionsForUser(req.user.id);
  }
  clearSessionCookie(res);
  return res.json({ message: 'Signed out everywhere' });
}

async function ensureUserExists(user: User) {
  const db = await getDb();
  await db.run(
    'INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, picture=excluded.picture',
    user.id, user.email, user.name, user.picture
  );
}

const SHARED_COLLABORATORS_FROM = `
  FROM users
  WHERE email != ? AND id IN (
    SELECT owner_id FROM maps WHERE id IN (
      SELECT id FROM maps WHERE owner_id = ?
      UNION
      SELECT p.map_id FROM map_permissions p JOIN maps m ON p.map_id = m.id WHERE p.user_id = ?
    )
    UNION
    SELECT p2.user_id FROM map_permissions p2 JOIN maps m2 ON p2.map_id = m2.id WHERE p2.map_id IN (
      SELECT id FROM maps WHERE owner_id = ?
      UNION
      SELECT p3.map_id FROM map_permissions p3 JOIN maps m3 ON p3.map_id = m3.id WHERE p3.user_id = ?
    )
  )
`;

function sharedCollaboratorParams(email: string, userId: string) {
  return [email, userId, userId, userId, userId];
}

export async function sharedContactsHandler(req: AuthRequest, res: Response) {
  try {
    const currentUserEmail = req.user?.email || '';
    const currentUserId = req.user?.id || '';
    const db = await getDb();
    const rows = await db.all(
      `SELECT email ${SHARED_COLLABORATORS_FROM} ORDER BY name ASC, email ASC LIMIT 200`,
      ...sharedCollaboratorParams(currentUserEmail, currentUserId)
    );
    return res.json({ emails: rows.map((r) => r.email.toLowerCase()) });
  } catch (err: any) {
    console.error('Failed to list shared contacts', err);
    res.status(500).json({ error: 'Failed to list shared contacts' });
  }
}

export async function searchUsersHandler(req: AuthRequest, res: Response) {
  try {
    const q = (req.query.q as string) || '';
    const currentUserEmail = req.user?.email || '';
    const currentUserId = req.user?.id || '';
    
    const db = await getDb();
    
    let baseQuery = `SELECT email, name, picture as photoUrl ${SHARED_COLLABORATORS_FROM}`;
    let queryParams: any[] = sharedCollaboratorParams(currentUserEmail, currentUserId);

    if (q.trim() !== '') {
      const searchTerm = `%${q.trim()}%`;
      baseQuery += ` AND (email LIKE ? OR name LIKE ?)`;
      queryParams.push(searchTerm, searchTerm);
    }
    
    baseQuery += ` ORDER BY name ASC, email ASC LIMIT 20`;
    
    const rows = await db.all(baseQuery, ...queryParams);
    
    // Add type 'other' so it fits the Contact interface on the client
    const users = rows.map(r => ({ ...r, type: 'other' }));
    
    return res.json({ users });
  } catch (err: any) {
    console.error('Failed to search users', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
}

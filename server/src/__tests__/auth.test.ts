import { describe, it, expect, afterEach } from 'vitest';
import { getJwtSecret, DEV_JWT_SECRET, isMockAuthAllowed, authenticateToken, AuthError } from '../auth';

describe('JWT production requirements', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  it('uses the development default when JWT_SECRET is unset outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;
    expect(getJwtSecret()).toBe(DEV_JWT_SECRET);
  });

  it('throws in production when JWT_SECRET is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET must be set/);
  });

  it('throws in production when JWT_SECRET is still the development default', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = DEV_JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET must be set/);
  });

  it('accepts a unique production secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-unique-production-secret-value-32';
    expect(getJwtSecret()).toBe('a-unique-production-secret-value-32');
  });
});

describe('mock auth gating', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  it('allows mock auth outside production', () => {
    process.env.NODE_ENV = 'test';
    expect(isMockAuthAllowed()).toBe(true);
  });

  it('rejects mock auth in production even if Google is unconfigured', () => {
    process.env.NODE_ENV = 'production';
    expect(isMockAuthAllowed()).toBe(false);
  });

  it('rejects mock user headers in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-unique-production-secret-value-32';
    await expect(
      authenticateToken(undefined, JSON.stringify({ id: 'mock-user-id', email: 'mock@example.com', name: 'Mock' }))
    ).rejects.toBeInstanceOf(AuthError);
  });
});

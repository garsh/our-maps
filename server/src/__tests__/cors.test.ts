import { describe, it, expect, afterEach } from 'vitest';
import { isAllowedOrigin } from '../cors';

describe('isAllowedOrigin', () => {
  const originalCors = process.env.CORS_ORIGIN;
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalCors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCors;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  it('allows requests with no Origin', () => {
    process.env.CORS_ORIGIN = 'https://ourmaps.mooo.com';
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it('allows the configured production origin', () => {
    process.env.CORS_ORIGIN = 'https://ourmaps.mooo.com';
    expect(isAllowedOrigin('https://ourmaps.mooo.com')).toBe(true);
  });

  it('allows comma-separated configured origins', () => {
    process.env.CORS_ORIGIN = 'https://ourmaps.mooo.com, https://bird.lan';
    expect(isAllowedOrigin('https://bird.lan')).toBe(true);
  });

  it('allows LAN hostname bird.lan over https and http', () => {
    process.env.CORS_ORIGIN = 'https://ourmaps.mooo.com';
    expect(isAllowedOrigin('https://bird.lan')).toBe(true);
    expect(isAllowedOrigin('http://bird.lan')).toBe(true);
    expect(isAllowedOrigin('http://bird.lan:3001')).toBe(true);
  });

  it('allows Vite and localhost dev origins on any port', () => {
    process.env.CORS_ORIGIN = 'https://ourmaps.mooo.com';
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('https://192.168.253.3')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3001')).toBe(true);
  });

  it('rejects substring bypasses of .lan, localhost, and 192.168.', () => {
    process.env.CORS_ORIGIN = 'https://ourmaps.mooo.com';
    expect(isAllowedOrigin('https://evil.landing.com')).toBe(false);
    expect(isAllowedOrigin('https://notlocalhost.com')).toBe(false);
    expect(isAllowedOrigin('https://192.168.attacker.com')).toBe(false);
    expect(isAllowedOrigin('https://evil-localhost.example')).toBe(false);
  });

  it('allows any origin when CORS_ORIGIN is *', () => {
    process.env.CORS_ORIGIN = '*';
    expect(isAllowedOrigin('https://evil.example')).toBe(true);
  });
});

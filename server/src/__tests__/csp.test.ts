import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { getCspDirectives } from '../csp';

function directiveSources(csp: string, name: string): string[] {
  const block = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `) || part === name);
  if (!block) return [];
  return block.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

describe('Content-Security-Policy', () => {
  it('does not allow eval, inline scripts, or catch-all http(s) schemes', () => {
    const directives = getCspDirectives();
    expect(directives['script-src']).not.toContain("'unsafe-eval'");
    expect(directives['script-src']).not.toContain("'unsafe-inline'");
    expect(directives['img-src']).not.toContain('https:');
    expect(directives['img-src']).not.toContain('http:');
    expect(directives['connect-src']).not.toContain('https:');
    expect(directives['connect-src']).not.toContain('http:');
    expect(directives['connect-src']).toContain("'self'");
    expect(directives['img-src']).toContain('https://*.googleusercontent.com');
  });

  it('sends the tightened policy on HTTP responses', async () => {
    const res = await request(app).get('/api/auth/search-users');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeTruthy();
    expect(csp).not.toContain('unsafe-eval');
    expect(directiveSources(csp, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directiveSources(csp, 'img-src')).not.toContain('https:');
    expect(directiveSources(csp, 'connect-src')).not.toContain('https:');
    expect(csp).toContain('accounts.google.com');
    expect(csp).toContain('googleusercontent.com');
  });
});

import { describe, it, expect } from 'vitest';
import { socketClientIp } from '../index';

describe('socketClientIp', () => {
  it('uses the socket address when the proxy is not trusted', () => {
    expect(socketClientIp('1.1.1.1, 2.2.2.2', '10.0.0.8', false)).toBe('10.0.0.8');
  });

  it('uses the last forwarded address when a proxy is trusted', () => {
    expect(socketClientIp('1.1.1.1, 203.0.113.9', '172.18.0.2', true)).toBe('203.0.113.9');
  });

  it('accepts a single forwarded address and an array of header values', () => {
    expect(socketClientIp('203.0.113.9', '172.18.0.2', true)).toBe('203.0.113.9');
    expect(socketClientIp(['1.1.1.1, 203.0.113.9'], '172.18.0.2', true)).toBe('203.0.113.9');
  });

  it('falls back when the forwarded header is missing or empty', () => {
    expect(socketClientIp(undefined, '172.18.0.2', true)).toBe('172.18.0.2');
    expect(socketClientIp('  ,  ', '172.18.0.2', true)).toBe('172.18.0.2');
  });
});

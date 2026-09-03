import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getStoredJson, setStoredJson, getStoredBoolean, setStoredBoolean, canFit, formatStorageMB, CHROME_PRIVACY_QUOTA_HEADROOM } from '../storageUtils';

describe('storageUtils', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getStoredJson & setStoredJson', () => {
    it('returns default value when key does not exist', () => {
      expect(getStoredJson('nonexistent', { fallback: true })).toEqual({ fallback: true });
    });

    it('sets and retrieves JSON values successfully', () => {
      const data = { a: 1, b: ['test', 'array'] };
      setStoredJson('test_key', data);
      expect(getStoredJson('test_key', null)).toEqual(data);
    });

    it('returns default value when JSON is corrupted', () => {
      localStorage.setItem('corrupt_key', '{not-valid-json');
      expect(getStoredJson('corrupt_key', ['default'])).toEqual(['default']);
    });
  });

  describe('getStoredBoolean & setStoredBoolean', () => {
    it('returns default boolean when key does not exist', () => {
      expect(getStoredBoolean('nonexistent', true)).toBe(true);
      expect(getStoredBoolean('nonexistent', false)).toBe(false);
    });

    it('sets and retrieves boolean values', () => {
      setStoredBoolean('bool_true', true);
      expect(getStoredBoolean('bool_true', false)).toBe(true);

      setStoredBoolean('bool_false', false);
      expect(getStoredBoolean('bool_false', true)).toBe(false);
    });
  });
});

describe('canFit', () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: originalStorage,
    });
  });

  function mockEstimate(quota: number, usage: number, persist?: () => Promise<boolean>) {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn(async () => ({ quota, usage })),
        persist: persist ?? vi.fn(async () => false),
      },
    });
  }

  it('formats storage sizes', () => {
    expect(formatStorageMB(0.4)).toBe('0.4 MB');
    expect(formatStorageMB(12)).toBe('12 MB');
    expect(formatStorageMB(1536)).toBe('1.5 GB');
  });

  it('allows downloads when storage estimate is unavailable', async () => {
    mockEstimate(0, 0);
    expect(await canFit(500)).toEqual({ ok: true, warn: false });
  });

  it('blocks downloads that will not fit in remaining space', async () => {
    mockEstimate(1000 * 1024 * 1024, 800 * 1024 * 1024);
    const result = await canFit(250);
    expect(result.ok).toBe(false);
    expect(result.warn).toBe(false);
    expect(result.message).toMatch(/Not enough storage/);
    expect(result.message).toMatch(/250 MB/);
    expect(result.message).toMatch(/200 MB/);
  });

  it('warns when a download uses more than 30% of remaining space', async () => {
    mockEstimate(1000 * 1024 * 1024, 0);
    const result = await canFit(400);
    expect(result.ok).toBe(true);
    expect(result.warn).toBe(true);
    expect(result.message).toMatch(/40%/);
    expect(result.message).toMatch(/Continue/);
  });

  it('does not warn when a download uses 30% or less of remaining space', async () => {
    mockEstimate(1000 * 1024 * 1024, 0);
    expect(await canFit(250)).toEqual({ ok: true, warn: false });
  });

  it('warns instead of blocking when Chrome reports the 10 GB privacy quota', async () => {
    mockEstimate(CHROME_PRIVACY_QUOTA_HEADROOM, 0);
    const result = await canFit(88.9 * 1024);
    expect(result.ok).toBe(true);
    expect(result.warn).toBe(true);
    expect(result.message).toMatch(/privacy limit/i);
    expect(result.message).toMatch(/88.9 GB/);
  });

  it('requests persistent storage before reading the estimate', async () => {
    const persist = vi.fn(async () => true);
    mockEstimate(100 * 1024 * 1024 * 1024, 0, persist);
    await canFit(100);
    expect(persist).toHaveBeenCalled();
  });
});

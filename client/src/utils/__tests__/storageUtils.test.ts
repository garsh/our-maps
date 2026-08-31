import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredJson, setStoredJson, getStoredBoolean, setStoredBoolean } from '../storageUtils';

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

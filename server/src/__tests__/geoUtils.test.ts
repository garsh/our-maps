import { describe, it, expect } from 'vitest';
import { parseAndClampBounds, isWithinBounds } from '../../../shared/geoUtils';

describe('geoUtils', () => {
  describe('parseAndClampBounds', () => {
    it('returns null for empty or invalid input', () => {
      expect(parseAndClampBounds(null)).toBeNull();
      expect(parseAndClampBounds('')).toBeNull();
      expect(parseAndClampBounds('invalid,bounds')).toBeNull();
      expect(parseAndClampBounds('1,2,3,abc')).toBeNull();
    });

    it('parses valid bounds and correctly identifies min/max coordinates', () => {
      const bounds = parseAndClampBounds('-122.5,37.8,-122.3,37.7');
      expect(bounds).not.toBeNull();
      expect(bounds?.boundWest).toBe(-122.5);
      expect(bounds?.boundEast).toBe(-122.3);
      expect(bounds?.boundNorth).toBe(37.8);
      expect(bounds?.boundSouth).toBe(37.7);
      expect(bounds?.minLat).toBe(37.7);
      expect(bounds?.maxLat).toBe(37.8);
    });

    it('clamps coordinates exceeding global ranges to -180..180 and -90..90', () => {
      const bounds = parseAndClampBounds('-200,-100,200,100');
      expect(bounds).not.toBeNull();
      expect(bounds?.boundWest).toBe(-180);
      expect(bounds?.boundEast).toBe(180);
      expect(bounds?.boundNorth).toBe(90);
      expect(bounds?.boundSouth).toBe(-90);
    });
  });

  describe('isWithinBounds', () => {
    const bounds = parseAndClampBounds('-10,10,10,-10');

    it('returns true when bounds is null', () => {
      expect(isWithinBounds(0, 0, null)).toBe(true);
    });

    it('correctly determines whether points are inside or outside', () => {
      expect(isWithinBounds(0, 0, bounds)).toBe(true);
      expect(isWithinBounds(5, -5, bounds)).toBe(true);
      expect(isWithinBounds('0.5', '-0.5', bounds)).toBe(true);
      expect(isWithinBounds(15, 0, bounds)).toBe(false);
      expect(isWithinBounds(0, 15, bounds)).toBe(false);
      expect(isWithinBounds(-15, 0, bounds)).toBe(false);
    });
  });
});

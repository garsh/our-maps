import { describe, it, expect } from 'vitest';
import { arePinsEqual, isValidPinColor, isValidPinIcon, resolvePinColorCode, getPreviewMarkerHTML, formatColorName, DEFAULT_ICON_COLORS, getDefaultColorForIcon } from '../mapUtils';
import type { Pin } from '@shared/interfaces';

describe('mapUtils', () => {
  describe('arePinsEqual', () => {
    const basePin: Pin = {
      id: 'p1',
      lat: 40.7128,
      lng: -74.0060,
      label: 'Coffee Shop',
      description: 'Best espresso',
      address: '123 Main St',
      color: 'blue',
      icon: 'restaurant',
      position: 0,
      layerId: 'layer-1'
    };

    it('returns true for identical pins', () => {
      const copy = { ...basePin };
      expect(arePinsEqual(basePin, copy)).toBe(true);
    });

    it('returns true when both are null/undefined', () => {
      expect(arePinsEqual(null, null)).toBe(true);
      expect(arePinsEqual(undefined, undefined)).toBe(true);
    });

    it('returns false when one is null/undefined', () => {
      expect(arePinsEqual(basePin, null)).toBe(false);
      expect(arePinsEqual(undefined, basePin)).toBe(false);
    });

    it('handles default values consistently', () => {
      const pinWithDefaults: Pin = {
        id: 'p2',
        lat: 10,
        lng: 20,
        position: 0
      };
      const pinWithExplicitDefaults: Pin = {
        id: 'p2',
        lat: 10,
        lng: 20,
        label: '',
        description: '',
        address: '',
        color: 'blue',
        icon: 'default',
        position: 0,
        layerId: undefined
      };
      expect(arePinsEqual(pinWithDefaults, pinWithExplicitDefaults)).toBe(true);
    });

    it('detects coordinate changes', () => {
      const movedPin = { ...basePin, lat: 40.7129 };
      expect(arePinsEqual(basePin, movedPin)).toBe(false);
    });

    it('detects layer moves', () => {
      const movedLayerPin = { ...basePin, layerId: 'layer-2' };
      expect(arePinsEqual(basePin, movedLayerPin)).toBe(false);
    });

    it('detects position changes', () => {
      const reorderedPin = { ...basePin, position: 5 };
      expect(arePinsEqual(basePin, reorderedPin)).toBe(false);
    });
  });

  describe('getPreviewMarkerHTML', () => {
    it('uses the same 20x28 pin box as map markers so the tip sits on the coordinate', () => {
      const preview = getPreviewMarkerHTML();
      expect(preview.width).toBe(20);
      expect(preview.height).toBe(28);
      expect(preview.html).toContain('width="20"');
      expect(preview.html).toContain('height="28"');
      expect(preview.html).toContain('viewBox="0 0 30 42"');
    });
  });

  describe('color and icon validation', () => {
    it('validates known colors and hex values', () => {
      expect(isValidPinColor('red')).toBe(true);
      expect(isValidPinColor('electric_blue')).toBe(true);
      expect(isValidPinColor('#123456')).toBe(true);
      expect(isValidPinColor('invalid_color')).toBe(false);
      expect(isValidPinColor(null)).toBe(false);
    });

    it('resolves color codes with fallbacks', () => {
      expect(resolvePinColorCode('red')).toBe('#CB2B3E');
      expect(resolvePinColorCode('electric_blue')).toBe('#0028FF');
      expect(resolvePinColorCode('#abcdef')).toBe('#abcdef');
      expect(resolvePinColorCode(null)).toBe('#2A81CB'); // default blue
    });

    it('formats color names for swatches and tooltips', () => {
      expect(formatColorName('blue')).toBe('Blue');
      expect(formatColorName('electric_blue')).toBe('Electric Blue');
      expect(formatColorName('#0028ff')).toBe('Custom color: #0028ff');
    });

    it('validates pin icons', () => {
      expect(isValidPinIcon('hotel')).toBe(true);
      expect(isValidPinIcon('restaurant')).toBe(true);
      expect(isValidPinIcon('nonexistent')).toBe(false);
    });

    it('maps pin icons to their correct default colors', () => {
      expect(DEFAULT_ICON_COLORS.default).toBe('blue');
      expect(DEFAULT_ICON_COLORS.hotel).toBe('violet');
      expect(DEFAULT_ICON_COLORS.restaurant).toBe('green');
      expect(DEFAULT_ICON_COLORS.airport).toBe('black');
      expect(DEFAULT_ICON_COLORS.car).toBe('black');
      expect(DEFAULT_ICON_COLORS.bus).toBe('black');
      expect(DEFAULT_ICON_COLORS.boat).toBe('black');
      expect(DEFAULT_ICON_COLORS.train).toBe('black');
      expect(DEFAULT_ICON_COLORS.gas).toBe('brown');
      expect(DEFAULT_ICON_COLORS.charging).toBe('brown');
      expect(DEFAULT_ICON_COLORS.shopping).toBe('pink');

      expect(getDefaultColorForIcon('hotel')).toBe('violet');
      expect(getDefaultColorForIcon('restaurant')).toBe('green');
      expect(getDefaultColorForIcon('airport')).toBe('black');
      expect(getDefaultColorForIcon('gas')).toBe('brown');
      expect(getDefaultColorForIcon('shopping')).toBe('pink');
      expect(getDefaultColorForIcon('default')).toBe('blue');
      expect(getDefaultColorForIcon(undefined)).toBe('blue');
    });
  });
});

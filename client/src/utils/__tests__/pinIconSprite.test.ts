import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPinIconKey, buildPinSvg, ensurePinImages, clearRegisteredImages } from '../pinIconSprite';
import type { Pin } from '@shared/interfaces';

describe('pinIconSprite', () => {
  beforeEach(() => {
    clearRegisteredImages();
  });

  it('generates correct unique icon keys', () => {
    expect(getPinIconKey('blue', 'default')).toBe('pin-#2A81CB-default');
    expect(getPinIconKey('red', 'hotel')).toBe('pin-#CB2B3E-hotel');
    expect(getPinIconKey('#123456', 'restaurant')).toBe('pin-#123456-restaurant');
  });

  it('builds SVG containing color code and icon paths', () => {
    const defaultSvg = buildPinSvg('#2A81CB', 'default');
    expect(defaultSvg).toContain('#2A81CB');
    expect(defaultSvg).toContain('<circle');

    const hotelSvg = buildPinSvg('#CB2B3E', 'hotel');
    expect(hotelSvg).toContain('#CB2B3E');
    expect(hotelSvg).toContain('<path');
  });

  it('registers pin images with map instance', async () => {
    const addedImages = new Map<string, any>();
    const mockMap = {
      hasImage: (key: string) => addedImages.has(key),
      addImage: (key: string, img: any) => addedImages.set(key, img),
    };

    const pins: Pin[] = [
      { id: '1', lat: 40, lng: -70, label: 'Pin 1', color: 'blue', icon: 'default', position: 0 },
      { id: '2', lat: 41, lng: -71, label: 'Pin 2', color: 'red', icon: 'hotel', position: 1 },
    ];

    await ensurePinImages(mockMap as any, pins);

    expect(mockMap.hasImage('pin-#2A81CB-default')).toBe(true);
    expect(mockMap.hasImage('pin-#CB2B3E-hotel')).toBe(true);
  });
});

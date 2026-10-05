import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidPinColor, isValidPinIcon, resolvePinColorCode, getPreviewMarkerHTML, formatColorName, DEFAULT_ICON_COLORS, pinsShareExactLocation, getCoLocatedPinIds, nextTargetPinIdAfterClick } from '../mapUtils';
import darkPng from '../../assets/basemap-sprites/dark@2x.png?inline';
import { applyBundledSpriteById, applyBundledSprites, bundledSpriteIconCount, isBundledSpriteId, resetBundledSpriteCacheForTests } from '../basemapSprites';
import {
  getMapViewportBounds,
  setMapViewportBounds,
  subscribeMapViewportBounds,
  resetMapViewportBoundsForTests,
} from '../mapViewport';
import { reverseGeocode, clearGeocodeCacheForTests } from '../geocoding';

function spriteMap(overrides: Record<string, unknown> = {}) {
  return {
    addImage: vi.fn(),
    removeImage: vi.fn(),
    updateImage: vi.fn(),
    hasImage: vi.fn(() => false),
    triggerRepaint: vi.fn(),
    ...overrides,
  };
}

function addedMarker(map: { addImage: ReturnType<typeof vi.fn> }, id: string) {
  const call = map.addImage.mock.calls.find((c) => c[0] === id);
  return call?.[1]?.data?.[0];
}

describe('mapUtils', () => {

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
    });
  });

  describe('co-located pins', () => {
    const pins = [
      { id: 'h1', lat: 40.0, lng: -105.0 },
      { id: 'h2', lat: 40.0, lng: -105.0 },
      { id: 'cafe', lat: 40.1, lng: -105.1 },
    ];

    it('treats identical coordinates as the same location', () => {
      expect(pinsShareExactLocation(pins[0], pins[1])).toBe(true);
      expect(pinsShareExactLocation(pins[0], pins[2])).toBe(false);
      expect(pinsShareExactLocation(null, pins[0])).toBe(false);
    });

    it('returns every pin id at the same exact location as the target', () => {
      expect(getCoLocatedPinIds(pins, 'h1')).toEqual(['h1', 'h2']);
      expect(getCoLocatedPinIds(pins, 'cafe')).toEqual(['cafe']);
      expect(getCoLocatedPinIds(pins, null)).toEqual([]);
      expect(getCoLocatedPinIds(pins, 'missing')).toEqual(['missing']);
    });

    it('toggles the whole co-located group off when any instance is clicked', () => {
      expect(nextTargetPinIdAfterClick('h1', 'h1', pins, { toggleSameLocation: true })).toBeNull();
      expect(nextTargetPinIdAfterClick('h1', 'h2', pins, { toggleSameLocation: true })).toBeNull();
      expect(nextTargetPinIdAfterClick('h1', 'cafe', pins, { toggleSameLocation: true })).toBe('cafe');
      expect(nextTargetPinIdAfterClick(null, 'h1', pins, { toggleSameLocation: true })).toBe('h1');
    });

    it('keeps the clicked pin selected when forceSelect is set', () => {
      expect(nextTargetPinIdAfterClick('h1', 'h1', pins, { forceSelect: true })).toBe('h1');
      expect(nextTargetPinIdAfterClick('h1', 'h2', pins, { forceSelect: true, toggleSameLocation: true })).toBe('h2');
      expect(nextTargetPinIdAfterClick(null, 'cafe', pins, { forceSelect: true })).toBe('cafe');
    });
  });

  describe('basemapSprites', () => {
    it('bundles light and dark @2x sprite atlases', () => {
      expect(bundledSpriteIconCount('light')).toBeGreaterThan(20);
      expect(bundledSpriteIconCount('dark')).toBeGreaterThan(20);
      expect(isBundledSpriteId('park')).toBe(true);
      expect(isBundledSpriteId('US:I-2char')).toBe(true);
      expect(isBundledSpriteId('not-a-sprite')).toBe(false);
    });

    describe('theme sheets', () => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;

      beforeEach(() => {
        class ImmediateImage {
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          private url = '';
          set src(value: string) {
            this.url = value;
            queueMicrotask(() => this.onload?.());
          }
          get src() {
            return this.url;
          }
        }
        vi.stubGlobal('Image', ImmediateImage);
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
          return {
            clearRect() {},
            drawImage(img: { src?: string }) {
              (this as { __spriteSrc?: string }).__spriteSrc = img?.src;
            },
            getImageData(_x: number, _y: number, w: number, h: number) {
              const data = new Uint8ClampedArray(w * h * 4);
              const sheet = (this as HTMLCanvasElement & { __spriteSrc?: string }).__spriteSrc;
              data[0] = sheet === darkPng ? 7 : 3;
              return { data, width: w, height: h };
            },
          } as unknown as CanvasRenderingContext2D;
        } as typeof HTMLCanvasElement.prototype.getContext;
        resetBundledSpriteCacheForTests();
      });

      afterEach(() => {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        vi.unstubAllGlobals();
        resetBundledSpriteCacheForTests();
      });

      it('registers the dark park and highway icons when the map opens in dark mode', async () => {
        const map = spriteMap();
        expect(await applyBundledSpriteById(map, 'park', 'dark')).toBe(true);
        expect(await applyBundledSpriteById(map, 'US:I-2char', 'dark')).toBe(true);
        expect(addedMarker(map, 'park')).toBe(7);
        expect(addedMarker(map, 'US:I-2char')).toBe(7);
      });

      it('does not replace a sprite already registered while the dark sheet was decoding', async () => {
        let present = false;
        const map = spriteMap({
          hasImage: () => present,
        });
        const pending = applyBundledSpriteById(map, 'park', 'dark');
        present = true;
        expect(await pending).toBe(true);
        expect(map.addImage).not.toHaveBeenCalled();
        expect(map.removeImage).not.toHaveBeenCalled();
      });

      it('leaves an existing icon in place when a missing-image request arrives late', async () => {
        const map = spriteMap({ hasImage: () => true });
        expect(await applyBundledSpriteById(map, 'park', 'light')).toBe(true);
        expect(map.addImage).not.toHaveBeenCalled();
        expect(map.removeImage).not.toHaveBeenCalled();
      });

      it('repaints icons already on the map when the theme sheet changes', async () => {
        const images = new Map<string, { data: Uint8ClampedArray }>();
        const map = spriteMap({
          hasImage: (id: string) => images.has(id),
          addImage: (id: string, imageData: { data: Uint8ClampedArray }) => {
            images.set(id, imageData);
          },
          updateImage: (id: string, imageData: { data: Uint8ClampedArray }) => {
            images.set(id, imageData);
          },
        });
        await applyBundledSpriteById(map, 'park', 'light');
        expect(images.get('park')?.data[0]).toBe(3);
        await applyBundledSprites(map, 'dark');
        expect(images.get('park')?.data[0]).toBe(7);
        expect(images.get('US:I-2char')?.data[0]).toBe(7);
        expect(map.removeImage).not.toHaveBeenCalled();
      });
    });
  });

  describe('mapViewport', () => {
    beforeEach(() => {
      resetMapViewportBoundsForTests();
    });

    afterEach(() => {
      resetMapViewportBoundsForTests();
    });

    it('does not notify subscribers when the bounds string is unchanged', () => {
      const listener = vi.fn();
      subscribeMapViewportBounds(listener);

      setMapViewportBounds('1,2,3,4');
      expect(getMapViewportBounds()).toBe('1,2,3,4');
      expect(listener).toHaveBeenCalledTimes(1);

      setMapViewportBounds('1,2,3,4');
      expect(listener).toHaveBeenCalledTimes(1);

      setMapViewportBounds('5,6,7,8');
      expect(listener).toHaveBeenCalledTimes(2);
      expect(getMapViewportBounds()).toBe('5,6,7,8');
    });
  });

  describe('reverseGeocode', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
      clearGeocodeCacheForTests();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('calls reverse-geocode API directly', async () => {
      const fetchMock = global.fetch as any;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ address: 'Direct Address' })
      });

      const result = await reverseGeocode(1, 1);
      
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/places/reverse-geocode'),
        expect.any(Object)
      );
      expect(result).toBe('Direct Address');
    });

    it('executes concurrent requests immediately without artificial serialization delay', async () => {
      const fetchMock = global.fetch as any;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ address: 'Test' })
      });

      const p1 = reverseGeocode(1, 1);
      const p2 = reverseGeocode(2, 2);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(r1).toBe('Test');
      expect(r2).toBe('Test');
    });

    it('coalesces in-flight lookups for the same rounded coordinates', async () => {
      const fetchMock = global.fetch as any;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ address: 'Same Block' }),
      });

      const p1 = reverseGeocode(1.00001, 1.00002);
      const p2 = reverseGeocode(1.00003, 1.00004);
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(r1).toBe('Same Block');
      expect(r2).toBe('Same Block');
    });

    it('reuses a successful cache hit and does not cache failures', async () => {
      const fetchMock = global.fetch as any;
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ address: 'Cached St' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          json: async () => ({ error: 'Reverse geocode failed' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ address: 'Retry St' }),
        });

      expect(await reverseGeocode(10, 20)).toBe('Cached St');
      expect(await reverseGeocode(10.00001, 20.00002)).toBe('Cached St');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      expect(await reverseGeocode(30, 40)).toBeNull();
      expect(await reverseGeocode(30, 40)).toBe('Retry St');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('returns null when the caller aborts and still allows a later lookup', async () => {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });
      global.fetch = fetchMock as any;

      const controller = new AbortController();
      const pending = reverseGeocode(4, 5, controller.signal);
      controller.abort();
      await expect(pending).resolves.toBeNull();

      fetchMock.mockReset();
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ address: 'After abort' }),
      });
      await expect(reverseGeocode(4, 5)).resolves.toBe('After abort');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

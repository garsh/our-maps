import { describe, it, expect, vi } from 'vitest';
import { countTiles, getTilesForArea, getPinsBoundingBox, getSurgicalBoxes } from '../tileUtils';
import type { Pin } from '@shared/interfaces';

describe('tileUtils', () => {
    const mockBox = {
        north: 45.1,
        south: 44.9,
        east: -73.9,
        west: -74.1
    };

    it('should correctly wrap longitude for tile coordinates', () => {
        // Test wrapping around 180/-180
        const tiles = getTilesForArea({ north: 10, south: 9, east: -179.9, west: 179.9 }, 1, 1);
        expect(tiles.length).toBeGreaterThan(0);
        tiles.forEach(t => {
            expect(t.x).toBeGreaterThanOrEqual(0);
            expect(t.x).toBeLessThan(2); // 2^1
        });
    });

    it('should clamp latitude for tile coordinates', () => {
        const tiles = getTilesForArea({ north: 89, south: 84, east: 10, west: 9 }, 5, 5);
        tiles.forEach(t => {
            expect(t.y).toBeGreaterThanOrEqual(0);
            expect(t.y).toBeLessThan(32); // 2^5
        });
    });

    it('should calculate bounding box for multiple pins with correct buffer', () => {
        const pins: Pin[] = [
            { id: '1', lat: 45, lng: -74, label: 'P1', position: 0 },
            { id: '2', lat: 46, lng: -73, label: 'P2', position: 1 }
        ] as any;

        const box = getPinsBoundingBox(pins);
        expect(box).not.toBeNull();
        expect(box!.north).toBeCloseTo(46.05, 5);
        expect(box!.south).toBeCloseTo(44.95, 5);
        expect(box!.east).toBeCloseTo(-72.95, 5);
        expect(box!.west).toBeCloseTo(-74.05, 5);
    });

    it('should calculate single pin bounding box matching Android logic', () => {
        const pins: Pin[] = [
            { id: '1', lat: 45, lng: -74, label: 'P1', position: 0 }
        ] as any;

        const box = getPinsBoundingBox(pins);
        expect(box).not.toBeNull();
        expect(box!.north).toBeCloseTo(45.06, 5);
        expect(box!.south).toBeCloseTo(44.94, 5);
    });

    it('should cluster surgical boxes correctly', () => {
        const pins: Pin[] = [
            { id: '1', lat: 45.001, lng: -74.001, label: 'P1', position: 0 },
            { id: '2', lat: 45.002, lng: -74.002, label: 'P2', position: 1 }, // Should merge with P1
            { id: '3', lat: 50.000, lng: -80.000, label: 'P3', position: 2 }  // Far away
        ] as any;

        const boxes = getSurgicalBoxes(pins);
        expect(boxes.length).toBe(2);
    });
});

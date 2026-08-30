import { describe, it, expect } from 'vitest';
import { reorderPins, isSameLayer, comparePinPositions } from '../reorderUtils';
import { Pin } from '@shared/interfaces';

describe('reorderUtils', () => {
    const pins: Pin[] = [
        { id: '1', label: 'P1', layerId: 'G1', position: 0, lat: 0, lng: 0 },
        { id: '2', label: 'P2', layerId: 'G1', position: 1, lat: 0, lng: 0 },
        { id: '3', label: 'P3', layerId: 'G2', position: 2, lat: 0, lng: 0 }
    ] as any;

    it('should reorder within the same layer (dragging down)', () => {
        const result = reorderPins(pins, '1', '2', 'pin', 'G1', new Set());
        expect(result[0].id).toBe('2');
        expect(result[1].id).toBe('1');
        expect(result[1].position).toBe(1);
    });

    it('should reorder within the same layer (dragging up)', () => {
        const result = reorderPins(pins, '2', '1', 'pin', 'G1', new Set());
        expect(result[0].id).toBe('2');
        expect(result[1].id).toBe('1');
    });

    it('should move to another layer and land at the end when dropped on header', () => {
        const result = reorderPins(pins, '3', 'G1', 'layer', 'G1', new Set());
        expect(result[2].id).toBe('3');
        expect(result[2].layerId).toBe('G1');
        expect(result[2].position).toBe(2);
    });

    it('should insert before the last dest pin when a parked pin is dropped on it', () => {
        const parked: Pin[] = [
            { id: 'b1', label: 'B1', layerId: 'B', position: 0, lat: 0, lng: 0 },
            { id: 'b2', label: 'B2', layerId: 'B', position: 1, lat: 0, lng: 0 },
            { id: 'b3', label: 'B3', layerId: 'B', position: 2, lat: 0, lng: 0 },
            { id: 'dragged', label: 'D', layerId: 'B', position: 3, lat: 0, lng: 0 },
        ] as any;
        const result = reorderPins(parked, 'dragged', 'b3', 'pin', 'B', new Set());
        expect(result.filter(p => p.layerId === 'B').map(p => p.id)).toEqual(['b1', 'b2', 'dragged', 'b3']);
    });

    it('should keep last place when a parked pin is dropped on itself', () => {
        const parked: Pin[] = [
            { id: 'b1', label: 'B1', layerId: 'B', position: 0, lat: 0, lng: 0 },
            { id: 'b2', label: 'B2', layerId: 'B', position: 1, lat: 0, lng: 0 },
            { id: 'b3', label: 'B3', layerId: 'B', position: 2, lat: 0, lng: 0 },
            { id: 'dragged', label: 'D', layerId: 'B', position: 3, lat: 0, lng: 0 },
        ] as any;
        const result = reorderPins(parked, 'dragged', 'dragged', 'pin', 'B', new Set());
        expect(result.filter(p => p.layerId === 'B').map(p => p.id)).toEqual(['b1', 'b2', 'b3', 'dragged']);
    });

    it('should land AFTER the last pin of another layer (last slot)', () => {
        const crossLayer: Pin[] = [
            { id: 'a1', label: 'A1', layerId: 'A', position: 0, lat: 0, lng: 0 },
            { id: 'a2', label: 'A2', layerId: 'A', position: 1, lat: 0, lng: 0 },
            { id: 'b1', label: 'B1', layerId: 'B', position: 2, lat: 0, lng: 0 },
            { id: 'dragged', label: 'D', layerId: 'B', position: 3, lat: 0, lng: 0 },
        ] as any;
        const result = reorderPins(crossLayer, 'dragged', 'a2', 'pin', 'A', new Set());
        expect(result.filter(p => p.layerId === 'A').map(p => p.id)).toEqual(['a1', 'a2', 'dragged']);
    });

    it('should move to another layer and land BEFORE a pin when dragging up', () => {
        // Mock state after onDragOver moved it to the end of G1
        const intermediatePins: Pin[] = [
            { id: '1', label: 'P1', layerId: 'G1', position: 0, lat: 0, lng: 0 },
            { id: '2', label: 'P2', layerId: 'G1', position: 1, lat: 0, lng: 0 },
            { id: '3', label: 'P3', layerId: 'G1', position: 2, lat: 0, lng: 0 }
        ] as any;
        
        // Drag 3 up to 1. ActiveIndex (2) > OverIndex (0). Should land BEFORE 1.
        const result = reorderPins(intermediatePins, '3', '1', 'pin', 'G1', new Set());
        expect(result[0].id).toBe('3');
        expect(result[1].id).toBe('1');
        expect(result[2].id).toBe('2');
    });

    it('should handle dropping on itself gracefully (keeping current order)', () => {
        const result = reorderPins(pins, '1', '1', 'pin', 'G1', new Set());
        expect(result).toEqual(pins);
    });

    it('should handle dropping on another pin in the same bundle gracefully', () => {
        const selectedIds = new Set(['1', '2']);
        const result = reorderPins(pins, '1', '2', 'pin', 'G1', selectedIds);
        expect(result).toEqual(pins);
    });

    it('should treat undefined, null, and empty string as equivalent default layer in isSameLayer', () => {
        expect(isSameLayer(undefined, null)).toBe(true);
        expect(isSameLayer(null, '')).toBe(true);
        expect(isSameLayer(undefined, 'G1')).toBe(false);
        expect(isSameLayer('G1', 'G1')).toBe(true);
    });

    it('should break position ties deterministically using ID in comparePinPositions', () => {
        const pinA = { id: 'pinA', position: 5 } as Pin;
        const pinB = { id: 'pinB', position: 5 } as Pin;
        expect(comparePinPositions(pinA, pinB)).toBeLessThan(0);
        expect(comparePinPositions(pinB, pinA)).toBeGreaterThan(0);
    });

    it('should move a multi-selected pin bundle to Default Layer correctly', () => {
        const selectedIds = new Set(['1', '2']);
        const result = reorderPins(pins, '1', 'default', 'layer', undefined, selectedIds);
        const defaultPins = result.filter(p => !p.layerId);
        expect(defaultPins.length).toBe(2);
        expect(defaultPins.map(p => p.id)).toContain('1');
        expect(defaultPins.map(p => p.id)).toContain('2');
    });

    it('should insert at the start of an expanded layer when dropped on its header', () => {
        const result = reorderPins(pins, '3', 'G1', 'layer', 'G1', new Set(), 'start');
        const g1 = result.filter(p => p.layerId === 'G1');
        expect(g1.map(p => p.id)).toEqual(['3', '1', '2']);
    });

    it('should move a 5-pin bundle onto the default layer header', () => {
        const manyPins: Pin[] = [
            { id: 'a', label: 'A', layerId: 'G1', position: 0, lat: 0, lng: 0 },
            { id: 'b', label: 'B', layerId: 'G1', position: 1, lat: 0, lng: 0 },
            { id: 'c', label: 'C', layerId: 'G1', position: 2, lat: 0, lng: 0 },
            { id: 'd', label: 'D', layerId: 'G1', position: 3, lat: 0, lng: 0 },
            { id: 'e', label: 'E', layerId: 'G1', position: 4, lat: 0, lng: 0 },
            { id: 'keep', label: 'Keep', layerId: 'G1', position: 5, lat: 0, lng: 0 },
        ] as any;
        const selectedIds = new Set(['a', 'b', 'c', 'd', 'e']);
        const result = reorderPins(manyPins, 'a', 'default', 'layer', undefined, selectedIds);
        const defaultPins = result.filter(p => !p.layerId);
        expect(defaultPins.map(p => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(result.find(p => p.id === 'keep')?.layerId).toBe('G1');
    });
});

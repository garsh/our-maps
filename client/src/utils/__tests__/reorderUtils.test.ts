import { describe, it, expect } from 'vitest';
import { reorderPins } from '../reorderUtils';
import { Pin } from '@shared/interfaces';

describe('reorderUtils', () => {
    const pins: Pin[] = [
        { id: '1', label: 'P1', groupId: 'G1', position: 0, lat: 0, lng: 0 },
        { id: '2', label: 'P2', groupId: 'G1', position: 1, lat: 0, lng: 0 },
        { id: '3', label: 'P3', groupId: 'G2', position: 2, lat: 0, lng: 0 }
    ] as any;

    it('should reorder within the same group (dragging down)', () => {
        const result = reorderPins(pins, '1', '2', 'pin', 'G1', new Set());
        expect(result[0].id).toBe('2');
        expect(result[1].id).toBe('1');
        expect(result[1].position).toBe(1);
    });

    it('should reorder within the same group (dragging up)', () => {
        const result = reorderPins(pins, '2', '1', 'pin', 'G1', new Set());
        expect(result[0].id).toBe('2');
        expect(result[1].id).toBe('1');
    });

    it('should move to another group and land at the end when dropped on header', () => {
        const result = reorderPins(pins, '3', 'G1', 'group', 'G1', new Set());
        expect(result[2].id).toBe('3');
        expect(result[2].groupId).toBe('G1');
        expect(result[2].position).toBe(2);
    });

    it('should move to another group and land BEFORE a pin when dragging up', () => {
        // Mock state after onDragOver moved it to the end of G1
        const intermediatePins: Pin[] = [
            { id: '1', label: 'P1', groupId: 'G1', position: 0, lat: 0, lng: 0 },
            { id: '2', label: 'P2', groupId: 'G1', position: 1, lat: 0, lng: 0 },
            { id: '3', label: 'P3', groupId: 'G1', position: 2, lat: 0, lng: 0 }
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
});

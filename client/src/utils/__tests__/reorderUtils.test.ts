import { describe, it, expect } from 'vitest';
import { reorderPins, reorderLayers, isSameLayer, comparePinPositions, emitPinMoveOrReorderEvents } from '../reorderUtils';
import { Pin } from '@shared/interfaces';

describe('reorderUtils', () => {
    const pins: Pin[] = [
        { id: '1', label: 'P1', layerId: 'G1', position: 0, lat: 0, lng: 0 },
        { id: '2', label: 'P2', layerId: 'G1', position: 1, lat: 0, lng: 0 },
        { id: '3', label: 'P3', layerId: 'G2', position: 2, lat: 0, lng: 0 }
    ] as any;

    it('should reorder within the same layer (placing after target pin)', () => {
        const result = reorderPins(pins, '1', '2', 'pin', 'G1', new Set());
        expect(result[0].id).toBe('2');
        expect(result[1].id).toBe('1');
        expect(result[1].position).toBe(1);
    });

    it('should move to top of layer when dropped on layer header', () => {
        const result = reorderPins(pins, '3', 'G1', 'layer', 'G1', new Set());
        expect(result[0].id).toBe('3');
        expect(result[0].layerId).toBe('G1');
        expect(result[0].position).toBe(0);
        expect(result[1].id).toBe('1');
        expect(result[2].id).toBe('2');
    });

    it('should move to another layer and place after target pin', () => {
        const result = reorderPins(pins, '3', '1', 'pin', 'G1', new Set());
        expect(result[0].id).toBe('1');
        expect(result[1].id).toBe('3');
        expect(result[1].layerId).toBe('G1');
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

    it('should reorder layers by placing after target layer', () => {
        const layers = [{ id: 'L1', name: 'L1', position: 0 }, { id: 'L2', name: 'L2', position: 1 }, { id: 'L3', name: 'L3', position: 2 }] as any;
        const result = reorderLayers(layers, 'L1', 'L2');
        expect(result[0].id).toBe('L2');
        expect(result[1].id).toBe('L1');
        expect(result[2].id).toBe('L3');
    });

    it('should move layer to first position when dropped on layer-top', () => {
        const layers = [{ id: 'L1', name: 'L1', position: 0 }, { id: 'L2', name: 'L2', position: 1 }, { id: 'L3', name: 'L3', position: 2 }] as any;
        const result = reorderLayers(layers, 'L3', 'layer-top');
        expect(result[0].id).toBe('L3');
        expect(result[1].id).toBe('L1');
        expect(result[2].id).toBe('L2');
    });

    it('should assign 0-indexed positions scoped per-layer across multiple layers', () => {
        const multiLayerPins: Pin[] = [
            { id: '1', label: 'P1', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            { id: '2', label: 'P2', layerId: 'L1', position: 1, lat: 0, lng: 0 },
            { id: '3', label: 'P3', layerId: 'L2', position: 0, lat: 0, lng: 0 },
            { id: '4', label: 'P4', layerId: 'L2', position: 1, lat: 0, lng: 0 },
        ] as any;
        const result = reorderPins(multiLayerPins, '1', '2', 'pin', 'L1', new Set());
        const l1Pins = result.filter(p => p.layerId === 'L1');
        const l2Pins = result.filter(p => p.layerId === 'L2');
        expect(l1Pins.map(p => p.position)).toEqual([0, 1]);
        expect(l2Pins.map(p => p.position)).toEqual([0, 1]);
    });

    it('should not allow moving or targeting default layer', () => {
        const layers = [{ id: 'L1', name: 'L1', position: 0 }, { id: 'L2', name: 'L2', position: 1 }] as any;
        expect(reorderLayers(layers, 'default', 'L1')).toEqual(layers);
        expect(reorderLayers(layers, 'L1', 'default')).toEqual(layers);
    });

    describe('emitPinMoveOrReorderEvents', () => {
        it('should emit pins-reorder when moved within the same layer', () => {
            const emitted: Array<{ event: string; data: any }> = [];
            const mockSocket = {
                emit: (event: string, data: any) => emitted.push({ event, data }),
            };
            const currentPins: Pin[] = [
                { id: '1', label: 'P1', layerId: 'L1', position: 0, lat: 0, lng: 0 },
                { id: '2', label: 'P2', layerId: 'L1', position: 1, lat: 0, lng: 0 },
            ];
            const startMap = new Map<string, string | undefined>([['1', 'L1']]);
            emitPinMoveOrReorderEvents(mockSocket, 'map1', currentPins, ['1'], startMap, 'L1');

            expect(emitted).toHaveLength(1);
            expect(emitted[0].event).toBe('pins-reorder');
            expect(emitted[0].data).toEqual({
                mapId: 'map1',
                layerId: 'L1',
                pinOrder: ['1', '2'],
            });
        });

        it('should emit pin-move-layer when moving across layers', () => {
            const emitted: Array<{ event: string; data: any }> = [];
            const mockSocket = {
                emit: (event: string, data: any) => emitted.push({ event, data }),
            };
            const currentPins: Pin[] = [
                { id: '1', label: 'P1', layerId: 'L2', position: 0, lat: 0, lng: 0 },
                { id: '2', label: 'P2', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            ];
            const startMap = new Map<string, string | undefined>([['1', 'L1']]);
            emitPinMoveOrReorderEvents(mockSocket, 'map1', currentPins, ['1'], startMap, 'L2', 'L1');

            expect(emitted.some(e => e.event === 'pin-move-layer')).toBe(true);
            const moveEvent = emitted.find(e => e.event === 'pin-move-layer')!;
            expect(moveEvent.data.mapId).toBe('map1');
            expect(moveEvent.data.pinIds).toEqual(['1']);
            expect(moveEvent.data.targetLayerId).toBe('L2');
            expect(moveEvent.data.sourceLayerId).toBe('L1');
        });
    });
});


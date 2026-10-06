import { describe, it, expect } from 'vitest';
import { reorderPins, reorderLayers, isSameLayer, comparePinPositions, emitPinMoveOrReorderEvents, applyRemotePinsReorder, applyRemotePinMoveLayer } from '../reorderUtils';
import { insertIdsAt, insertIndexAfterMove } from '@shared/pinOrder';
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

    it('should move to top of layer when dropped on layer header of an open layer', () => {
        const result = reorderPins(pins, '3', 'G1', 'layer', 'G1', new Set(), new Set());
        expect(result[0].id).toBe('3');
        expect(result[0].layerId).toBe('G1');
        expect(result[0].position).toBe(0);
        expect(result[1].id).toBe('1');
        expect(result[2].id).toBe('2');
    });

    it('should append to end of layer when dropped on layer header of a closed layer', () => {
        const collapsed = new Set(['G1']);
        const result = reorderPins(pins, '3', 'G1', 'layer', 'G1', new Set(), collapsed);
        expect(result[0].id).toBe('1');
        expect(result[1].id).toBe('2');
        expect(result[2].id).toBe('3');
        expect(result[2].layerId).toBe('G1');
        expect(result[2].position).toBe(2);
    });

    it('should append to end of default layer when dropped on closed default layer header', () => {
        const mixedPins: Pin[] = [
            { id: '1', label: 'P1', layerId: 'G1', position: 0, lat: 0, lng: 0 },
            { id: '2', label: 'P2', layerId: undefined, position: 0, lat: 0, lng: 0 },
            { id: '3', label: 'P3', layerId: undefined, position: 1, lat: 0, lng: 0 }
        ] as any;
        const collapsed = new Set<string | null>([null]);
        const result = reorderPins(mixedPins, '1', 'default', 'layer', undefined, new Set(), collapsed);
        const defaultPins = result.filter(p => !p.layerId);
        expect(defaultPins.length).toBe(3);
        expect(defaultPins[2].id).toBe('1');
        expect(defaultPins[2].position).toBe(2);
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

    it('keeps a gap in a layer the drag does not reorder', () => {
        const gapped: Pin[] = [
            { id: '1', label: 'P1', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            { id: '2', label: 'P2', layerId: 'L1', position: 1, lat: 0, lng: 0 },
            { id: '3', label: 'P3', layerId: 'L2', position: 0, lat: 0, lng: 0 },
            { id: '4', label: 'P4', layerId: 'L2', position: 5, lat: 0, lng: 0 },
        ];
        const result = reorderPins(gapped, '1', '2', 'pin', 'L1', new Set());
        const l2 = result.filter(p => p.layerId === 'L2').sort(comparePinPositions);
        expect(l2.map(p => p.position)).toEqual([0, 5]);
    });

    it('appends onto a gapped layer and leaves the source position', () => {
        const gapped: Pin[] = [
            { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
            { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
            { id: 'd', label: 'D', layerId: 'L2', position: 4, lat: 0, lng: 0 },
        ];
        const collapsed = new Set(['L1']);
        const result = reorderPins(gapped, 'c', 'L1', 'layer', 'L1', new Set(), collapsed);
        const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
        const l2 = result.filter(p => p.layerId === 'L2').sort(comparePinPositions);
        expect(l1.map(p => [p.id, p.position])).toEqual([['a', 0], ['b', 5], ['c', 6]]);
        expect(l2.map(p => [p.id, p.position])).toEqual([['d', 4]]);
    });

    function positionsMatchServer(
        before: Pin[],
        activeId: string,
        overId: string,
        overType: 'pin' | 'layer',
        overLayerId: string | undefined,
        selected: Set<string>,
        collapsed?: Set<string | null>
    ) {
        const movingIds = selected.has(activeId) ? Array.from(selected) : [activeId];
        const start = new Map<string, string | undefined>();
        for (const id of movingIds) {
            const pin = before.find(p => p.id === id);
            if (pin) start.set(id, pin.layerId);
        }
        const local = reorderPins(before, activeId, overId, overType, overLayerId, selected, collapsed);
        const emitted: Array<{ event: string; data: any }> = [];
        emitPinMoveOrReorderEvents(
            { emit: (event: string, data: any) => emitted.push({ event, data }) },
            'map1',
            local,
            movingIds,
            start,
            overLayerId
        );
        expect(emitted).toHaveLength(1);
        const event = emitted[0];
        const applied = event.event === 'pins-reorder'
            ? applyRemotePinsReorder(before, event.data.layerId ?? undefined, event.data.pinIds, event.data.insertIndex)
            : applyRemotePinMoveLayer(before, event.data.pinIds, event.data.targetLayerId ?? undefined, event.data.destInsertIndex);
        const localById = new Map(local.map(p => [p.id, p]));
        for (const pin of applied) {
            const match = localById.get(pin.id);
            expect(match?.position).toBe(pin.position);
            expect(isSameLayer(match?.layerId, pin.layerId)).toBe(true);
        }
    }

    it('gives the dragging client the same positions the server stores', () => {
        const gapped: Pin[] = [
            { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
            { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
            { id: 'd', label: 'D', layerId: 'L2', position: 4, lat: 0, lng: 0 },
        ];
        positionsMatchServer(gapped, 'a', 'b', 'pin', 'L1', new Set());
        positionsMatchServer(gapped, 'c', 'L1', 'layer', 'L1', new Set(), new Set(['L1']));
        positionsMatchServer(gapped, 'c', 'L1', 'layer', 'L1', new Set(), new Set());
        positionsMatchServer(gapped, 'c', 'b', 'pin', 'L1', new Set());
        positionsMatchServer(gapped, 'b', 'L2', 'layer', 'L2', new Set(['b', 'c']), new Set(['L2']));
    });

    it('rewrites the destination when a pin is dropped at the top and leaves the source position', () => {
        const gapped: Pin[] = [
            { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
            { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
            { id: 'd', label: 'D', layerId: 'L2', position: 4, lat: 0, lng: 0 },
        ];
        const result = reorderPins(gapped, 'c', 'L1', 'layer', 'L1', new Set(), new Set());
        const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
        const l2 = result.filter(p => p.layerId === 'L2').sort(comparePinPositions);
        expect(l1.map(p => [p.id, p.position])).toEqual([['c', 0], ['a', 1], ['b', 2]]);
        expect(l2.map(p => [p.id, p.position])).toEqual([['d', 4]]);
    });

    it('packs a gapped layer on a same-layer reorder and leaves another layer gapped', () => {
        const gapped: Pin[] = [
            { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
            { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
            { id: 'd', label: 'D', layerId: 'L2', position: 9, lat: 0, lng: 0 },
        ];
        const result = reorderPins(gapped, 'a', 'b', 'pin', 'L1', new Set());
        const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
        expect(l1.map(p => [p.id, p.position])).toEqual([['b', 0], ['a', 1]]);
        expect(result.find(p => p.id === 'c')).toBe(gapped[2]);
        expect(result.find(p => p.id === 'd')).toBe(gapped[3]);
        positionsMatchServer(gapped, 'a', 'b', 'pin', 'L1', new Set());
    });

    it('rewrites the destination for a drop between pins and leaves the source and a third layer', () => {
        const gapped: Pin[] = [
            { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
            { id: 'e', label: 'E', layerId: 'L1', position: 8, lat: 0, lng: 0 },
            { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
            { id: 'd', label: 'D', layerId: 'L2', position: 4, lat: 0, lng: 0 },
            { id: 'o', label: 'O', layerId: 'L3', position: 9, lat: 0, lng: 0 },
        ];
        const result = reorderPins(gapped, 'c', 'a', 'pin', 'L1', new Set());
        const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
        expect(l1.map(p => [p.id, p.position])).toEqual([['a', 0], ['c', 1], ['b', 2], ['e', 3]]);
        expect(result.find(p => p.id === 'd')).toBe(gapped[4]);
        expect(result.find(p => p.id === 'o')).toBe(gapped[5]);
        positionsMatchServer(gapped, 'c', 'a', 'pin', 'L1', new Set());
    });

    it('appends a multi-pin block after the destination max in selection order', () => {
        const gapped: Pin[] = [
            { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
            { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
            { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
            { id: 'e', label: 'E', layerId: 'L2', position: 3, lat: 0, lng: 0 },
            { id: 'd', label: 'D', layerId: 'L2', position: 4, lat: 0, lng: 0 },
            { id: 'o', label: 'O', layerId: 'L3', position: 9, lat: 0, lng: 0 },
        ];
        const selected = new Set(['c', 'e']);
        const result = reorderPins(gapped, 'c', 'L1', 'layer', 'L1', selected, new Set(['L1']));
        const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
        expect(l1.map(p => [p.id, p.position])).toEqual([['a', 0], ['b', 5], ['c', 6], ['e', 7]]);
        expect(result.find(p => p.id === 'd')).toBe(gapped[4]);
        expect(result.find(p => p.id === 'o')).toBe(gapped[5]);
        positionsMatchServer(gapped, 'c', 'L1', 'layer', 'L1', selected, new Set(['L1']));
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
                pinIds: ['1'],
                insertIndex: 0,
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
            emitPinMoveOrReorderEvents(mockSocket, 'map1', currentPins, ['1'], startMap, 'L2');

            expect(emitted.some(e => e.event === 'pin-move-layer')).toBe(true);
            const moveEvent = emitted.find(e => e.event === 'pin-move-layer')!;
            expect(moveEvent.data).toEqual({
                mapId: 'map1',
                pinIds: ['1'],
                targetLayerId: 'L2',
                destInsertIndex: 0,
            });
            expect(emitted).toHaveLength(1);
        });

        it('emits destInsertIndex at remaining.length when moving a block to the end', () => {
            const emitted: Array<{ event: string; data: any }> = [];
            const mockSocket = {
                emit: (event: string, data: any) => emitted.push({ event, data }),
            };
            const currentPins: Pin[] = [
                { id: 'd1', label: 'D1', position: 0, lat: 0, lng: 0 },
                { id: 'd2', label: 'D2', position: 1, lat: 0, lng: 0 },
                { id: 'd3', label: 'D3', position: 2, lat: 0, lng: 0 },
                { id: 'm1', label: 'M1', position: 3, lat: 0, lng: 0 },
                { id: 'm2', label: 'M2', position: 4, lat: 0, lng: 0 },
            ];
            const startMap = new Map<string, string | undefined>([['m1', 'L1'], ['m2', 'L1']]);
            emitPinMoveOrReorderEvents(mockSocket, 'map1', currentPins, ['m1', 'm2'], startMap, undefined);

            expect(emitted[0].event).toBe('pin-move-layer');
            expect(emitted[0].data.destInsertIndex).toBe(3);
            expect(emitted[0].data.pinIds).toEqual(['m1', 'm2']);
        });

        it('includes a pin already in the destination when it is part of the dropped block', () => {
            const emitted: Array<{ event: string; data: any }> = [];
            const mockSocket = {
                emit: (event: string, data: any) => emitted.push({ event, data }),
            };
            const currentPins: Pin[] = [
                { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
                { id: 'b', label: 'B', layerId: 'L1', position: 1, lat: 0, lng: 0 },
                { id: 'c', label: 'C', layerId: 'L1', position: 2, lat: 0, lng: 0 },
            ];
            const startMap = new Map<string, string | undefined>([['b', 'L1'], ['c', 'L2']]);
            emitPinMoveOrReorderEvents(mockSocket, 'map1', currentPins, ['b', 'c'], startMap, 'L1');

            expect(emitted[0].event).toBe('pin-move-layer');
            expect(emitted[0].data.pinIds).toEqual(['b', 'c']);
            expect(emitted[0].data.destInsertIndex).toBe(1);
        });
    });

    describe('insertIdsAt / remote apply', () => {
        it('inserts a moved block at the remaining-list index', () => {
            expect(insertIdsAt(['a', 'b', 'c', 'd'], ['d'], 1)).toEqual(['a', 'd', 'b', 'c']);
            expect(insertIdsAt(['a', 'b', 'c'], ['a'], 2)).toEqual(['b', 'c', 'a']);
            expect(insertIndexAfterMove(['b', 'a', 'c'], ['a'])).toBe(1);
            expect(insertIndexAfterMove(['b', 'c', 'a'], ['a'])).toBe(2);
            expect(insertIndexAfterMove(['d1', 'd2', 'd3', 'm1', 'm2'], ['m1', 'm2'])).toBe(3);
        });

        it('applies a compact same-layer reorder', () => {
            const result = applyRemotePinsReorder(pins, 'G1', ['2'], 0);
            const g1 = result.filter(p => p.layerId === 'G1').sort(comparePinPositions);
            expect(g1.map(p => p.id)).toEqual(['2', '1']);
            expect(g1.map(p => p.position)).toEqual([0, 1]);
        });

        it('rewrites the destination for an insert at the top and keeps the source position', () => {
            const withSource: Pin[] = [
                ...pins,
                { id: '4', label: 'P4', layerId: 'G2', position: 6, lat: 0, lng: 0 },
            ];
            const result = applyRemotePinMoveLayer(withSource, ['3'], 'G1', 0);
            const g1 = result.filter(p => p.layerId === 'G1').sort(comparePinPositions);
            const g2 = result.filter(p => p.layerId === 'G2').sort(comparePinPositions);
            expect(g1.map(p => p.id)).toEqual(['3', '1', '2']);
            expect(g1.map(p => p.position)).toEqual([0, 1, 2]);
            expect(g2.map(p => [p.id, p.position])).toEqual([['4', 6]]);
        });

        it('appends a moved block after the destination max', () => {
            const dest: Pin[] = [
                { id: 'd1', label: 'D1', position: 0, lat: 0, lng: 0 },
                { id: 'd2', label: 'D2', position: 4, lat: 0, lng: 0 },
                { id: 'd3', label: 'D3', position: 7, lat: 0, lng: 0 },
                { id: 'm1', label: 'M1', layerId: 'L1', position: 0, lat: 0, lng: 0 },
                { id: 'm2', label: 'M2', layerId: 'L1', position: 1, lat: 0, lng: 0 },
                { id: 's1', label: 'S1', layerId: 'L1', position: 3, lat: 0, lng: 0 },
            ];
            const result = applyRemotePinMoveLayer(dest, ['m1', 'm2'], undefined, 3);
            const defaults = result.filter(p => !p.layerId).sort(comparePinPositions);
            expect(defaults.map(p => [p.id, p.position])).toEqual([
                ['d1', 0],
                ['d2', 4],
                ['d3', 7],
                ['m1', 8],
                ['m2', 9],
            ]);
            expect(result.find(p => p.id === 's1')?.position).toBe(3);
        });

        it('appends a pin that is already in the destination without packing the pins that stay', () => {
            const pinsInPlace: Pin[] = [
                { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
                { id: 'm', label: 'M', layerId: 'L1', position: 3, lat: 0, lng: 0 },
                { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
                { id: 'c', label: 'C', layerId: 'L2', position: 1, lat: 0, lng: 0 },
                { id: 's', label: 'S', layerId: 'L2', position: 4, lat: 0, lng: 0 },
                { id: 'o', label: 'O', layerId: 'L3', position: 9, lat: 0, lng: 0 },
            ];
            const result = applyRemotePinMoveLayer(pinsInPlace, ['b', 'c'], 'L1', 2);
            const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
            expect(l1.map(p => [p.id, p.position])).toEqual([['a', 0], ['m', 3], ['b', 4], ['c', 5]]);
            expect(result.find(p => p.id === 'a')).toBe(pinsInPlace[0]);
            expect(result.find(p => p.id === 'm')).toBe(pinsInPlace[1]);
            expect(result.find(p => p.id === 's')).toBe(pinsInPlace[4]);
            expect(result.find(p => p.id === 'o')).toBe(pinsInPlace[5]);
        });

        it('inserts between two gapped destination pins and leaves other layers unchanged', () => {
            const gapped: Pin[] = [
                { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
                { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
                { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
                { id: 's', label: 'S', layerId: 'L2', position: 4, lat: 0, lng: 0 },
                { id: 'o', label: 'O', layerId: 'L3', position: 9, lat: 0, lng: 0 },
            ];
            const result = applyRemotePinMoveLayer(gapped, ['c'], 'L1', 1);
            const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
            expect(l1.map(p => [p.id, p.position])).toEqual([['a', 0], ['c', 1], ['b', 2]]);
            expect(result.find(p => p.id === 's')).toBe(gapped[3]);
            expect(result.find(p => p.id === 'o')).toBe(gapped[4]);
        });

        it('treats an index past the end as an append and ignores unknown or duplicate ids', () => {
            const gapped: Pin[] = [
                { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
                { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
                { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
                { id: 's', label: 'S', layerId: 'L2', position: 4, lat: 0, lng: 0 },
            ];
            const result = applyRemotePinMoveLayer(gapped, ['missing', 'c', 'c'], 'L1', 99);
            const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
            expect(l1.map(p => [p.id, p.position])).toEqual([['a', 0], ['b', 5], ['c', 6]]);
            expect(result.find(p => p.id === 's')).toBe(gapped[3]);
            expect(applyRemotePinMoveLayer(gapped, ['missing'], 'L1', 0)).toBe(gapped);
        });

        it('packs only the reordered layer when applying a same-layer reorder', () => {
            const gapped: Pin[] = [
                { id: 'a', label: 'A', layerId: 'L1', position: 0, lat: 0, lng: 0 },
                { id: 'b', label: 'B', layerId: 'L1', position: 5, lat: 0, lng: 0 },
                { id: 'c', label: 'C', layerId: 'L2', position: 2, lat: 0, lng: 0 },
                { id: 'd', label: 'D', layerId: 'L2', position: 9, lat: 0, lng: 0 },
            ];
            const result = applyRemotePinsReorder(gapped, 'L1', ['a'], 1);
            const l1 = result.filter(p => p.layerId === 'L1').sort(comparePinPositions);
            expect(l1.map(p => [p.id, p.position])).toEqual([['b', 0], ['a', 1]]);
            expect(result.find(p => p.id === 'c')).toBe(gapped[2]);
            expect(result.find(p => p.id === 'd')).toBe(gapped[3]);
        });
    });
});


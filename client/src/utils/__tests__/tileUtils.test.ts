import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTilesForArea, getPinsBoundingBox, countTiles, getXRanges, saveMapOffline, getOfflineMap, isMapDownloaded, removeMapDownload, removeAllDownloads, getDownloadStats, getMapDownloadStatuses, resetDBForTesting, openDB } from '../tileUtils';
import type { Pin } from '@shared/interfaces';

const { mockExtracts, mockPartSizes, mockMetaBytes } = vi.hoisted(() => ({
    mockExtracts: new Set<string>(),
    mockPartSizes: new Map<string, number>(),
    mockMetaBytes: new Map<string, number>(),
}));

vi.mock('../extractStore', () => ({
    extractExists: async (id: string) => mockExtracts.has(id),
    getPartFileSize: async (id: string) => mockPartSizes.get(id) || 0,
    getExtractResumeInfo: async (id: string) => ({
        partBytes: mockPartSizes.get(id) || 0,
        totalBytes: mockMetaBytes.get(id) || 0,
    }),
    readExtractMeta: async (id: string) => {
        const totalBytes = mockMetaBytes.get(id) || 0;
        return totalBytes > 0 ? { totalBytes } : null;
    },
    writeExtractMeta: async (id: string, meta: { totalBytes: number }) => {
        mockMetaBytes.set(id, meta.totalBytes);
    },
    removeExtract: async (id: string) => { mockExtracts.delete(id); mockPartSizes.delete(id); mockMetaBytes.delete(id); },
    removeAllExtracts: async () => { mockExtracts.clear(); mockPartSizes.clear(); mockMetaBytes.clear(); },
    invalidateExtractCache: () => {},
}));

describe('tileUtils', () => {
    let openSpy: any;
    let stores: Map<string, Map<any, any>>;

    beforeEach(() => {
        resetDBForTesting();
        mockExtracts.clear();
        mockPartSizes.clear();
        mockMetaBytes.clear();
        stores = new Map<string, Map<any, any>>();
        const getStore = (name: string) => {
            if (!stores.has(name)) stores.set(name, new Map());
            return stores.get(name)!;
        };
        openSpy = vi.fn(() => {
            const req: any = {
                result: {
                    objectStoreNames: { contains: (name: string) => name === 'maps' || stores.has(name) },
                    transaction: (_names?: string | string[]) => {
                        const tx: any = {
                            objectStore: (name: string) => {
                                const txStore = getStore(name);
                                return {
                                    put: (val: any, key?: any) => {
                                        txStore.set(key !== undefined ? key : (val?.id ?? val?.url), val);
                                        const r: any = {};
                                        setTimeout(() => r.onsuccess && r.onsuccess());
                                        return r;
                                    },
                                    get: (id: string) => {
                                        const r: any = {};
                                        setTimeout(() => {
                                            r.result = txStore.get(id);
                                            r.onsuccess && r.onsuccess();
                                        });
                                        return r;
                                    },
                                    getAll: () => {
                                        const r: any = {};
                                        setTimeout(() => {
                                            r.result = Array.from(txStore.values());
                                            r.onsuccess && r.onsuccess();
                                        });
                                        return r;
                                    },
                                    delete: (id: string) => {
                                        txStore.delete(id);
                                        const r: any = {};
                                        setTimeout(() => r.onsuccess && r.onsuccess());
                                        return r;
                                    },
                                    clear: () => {
                                        txStore.clear();
                                        const r: any = {};
                                        setTimeout(() => r.onsuccess && r.onsuccess());
                                        return r;
                                    },
                                };
                            },
                            oncomplete: null,
                            onerror: null
                        };
                        setTimeout(() => tx.oncomplete && tx.oncomplete(), 20);
                        return tx;
                    },
                    close: () => {}
                },
                onsuccess: null,
                onerror: null,
                onupgradeneeded: null
            };
            setTimeout(() => {
                if (req.onupgradeneeded) req.onupgradeneeded();
                if (req.onsuccess) req.onsuccess();
            });
            return req;
        });
        (global as any).indexedDB = {
            open: openSpy,
            deleteDatabase: vi.fn(() => {
                stores.clear();
                const req: any = {};
                setTimeout(() => req.onsuccess && req.onsuccess());
                return req;
            })
        };
    });

    it('should correctly wrap longitude for tile coordinates', () => {
        const tiles = getTilesForArea({ north: 10, south: 9, east: -179.9, west: 179.9 }, 1, 1);
        expect(tiles.length).toBeGreaterThan(0);
        tiles.forEach(t => {
            expect(t.x).toBeGreaterThanOrEqual(0);
            expect(t.x).toBeLessThan(2);
        });
    });

    it('should clamp latitude for tile coordinates', () => {
        const tiles = getTilesForArea({ north: 89, south: 84, east: 10, west: 9 }, 5, 5);
        tiles.forEach(t => {
            expect(t.y).toBeGreaterThanOrEqual(0);
            expect(t.y).toBeLessThan(32);
        });
    });

    it('should calculate bounding box for multiple pins with correct buffer', () => {
        const pins: Pin[] = [
            { id: '1', lat: 45, lng: -74, label: 'P1', position: 0 },
            { id: '2', lat: 46, lng: -73, label: 'P2', position: 1 }
        ] as any;

        const box = getPinsBoundingBox(pins);
        expect(box).not.toBeNull();
        expect(box!.north).toBeCloseTo(46.15, 5);
        expect(box!.south).toBeCloseTo(44.85, 5);
        expect(box!.east).toBeCloseTo(-72.85, 5);
        expect(box!.west).toBeCloseTo(-74.15, 5);
    });

    it('should calculate single pin bounding box matching Android logic', () => {
        const pins: Pin[] = [
            { id: '1', lat: 45, lng: -74, label: 'P1', position: 0 }
        ] as any;

        const box = getPinsBoundingBox(pins);
        expect(box).not.toBeNull();
        expect(box!.north).toBeCloseTo(45.15, 5);
        expect(box!.south).toBeCloseTo(44.85, 5);
    });

    it('should accurately count tiles for bounding box across zoom range', () => {
        const bbox = { north: 45.1, south: 44.9, east: -73.9, west: -74.1 };
        const count = countTiles(bbox, 1, 15);
        expect(count).toBeGreaterThan(0);

        const zoom1to10 = countTiles(bbox, 1, 10);
        const zoom11to15 = countTiles(bbox, 11, 15);
        expect(count).toBe(zoom1to10 + zoom11to15);
    });

    it('should generate all tiles for area across zoom levels 1 to 15 without gaps', () => {
        const bbox = { north: 40.75, south: 40.70, east: -73.95, west: -74.00 };
        const tiles = getTilesForArea(bbox, 1, 15);
        expect(tiles.length).toBe(countTiles(bbox, 1, 15));

        const zoomsPresent = new Set(tiles.map(t => t.z));
        for (let z = 1; z <= 15; z++) {
            expect(zoomsPresent.has(z)).toBe(true);
        }
    });

    it('should generate and count full bounding box coverage for zooms 1 to 15', () => {
        const pins: Pin[] = [
            { id: '1', lat: 20.88, lng: -156.51, label: 'Maui Pin', position: 0 },
            { id: '2', lat: 19.72, lng: -155.11, label: 'Big Island Pin', position: 1 }
        ] as any;
        const bbox = getPinsBoundingBox(pins)!;

        const count = countTiles(bbox, 1, 15);
        const tiles = getTilesForArea(bbox, 1, 15);

        expect(tiles.length).toBe(count);
        expect(count).toBeGreaterThan(0);

        const z15Count = countTiles(bbox, 15, 15);
        const z15Tiles = tiles.filter(t => t.z === 15);
        expect(z15Tiles.length).toBe(z15Count);
    });

    it('should correctly handle antimeridian crossing in getXRanges and tile generation', () => {
        const ranges = getXRanges(179, -179, 3);
        expect(ranges.length).toBe(2);
        expect(ranges[0][0]).toBe(7);
        expect(ranges[0][1]).toBe(7);
        expect(ranges[1][0]).toBe(0);
        expect(ranges[1][1]).toBe(0);

        const bboxCross = { north: 10, south: -10, west: 179, east: -179 };
        const tilesCross = getTilesForArea(bboxCross, 2, 2);
        expect(tilesCross.length).toBe(countTiles(bboxCross, 2, 2));
        expect(tilesCross.length).toBeGreaterThan(0);
    });

    it('should include contextual buffer around bounding box at intermediate zoom levels 5 to 9', () => {
        const bbox = { north: 40.75, south: 40.74, east: -73.98, west: -73.99 };
        expect(getTilesForArea(bbox, 6, 6).length).toBe(25);
        expect(getTilesForArea(bbox, 7, 7).length).toBe(25);
        expect(getTilesForArea(bbox, 8, 8).length).toBe(25);
        expect(getTilesForArea(bbox, 9, 9).length).toBe(9);
    });

    it('should save, retrieve, and remove offline map metadata', async () => {
        const mockMapData = {
            id: 'offline-map-123',
            name: 'Offline Test Map',
            ownerId: 'user-1',
            layers: [{ id: 'l1', name: 'Layer 1', color: '#ff0000', position: 0 }],
            pins: [{ id: 'p1', lat: 40, lng: -70, label: 'Pin 1', position: 0 }],
            userRole: 'owner' as const
        };

        await saveMapOffline(mockMapData as any);
        const retrieved = await getOfflineMap('offline-map-123');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.name).toBe('Offline Test Map');
        expect(retrieved?.pins.length).toBe(1);
        expect(await isMapDownloaded('offline-map-123')).toBe(false);

        mockExtracts.add('offline-map-123');
        expect(await isMapDownloaded('offline-map-123')).toBe(true);
        await removeMapDownload('offline-map-123');
        const afterRemove = await getOfflineMap('offline-map-123');
        expect(afterRemove).toBeNull();
        expect(await isMapDownloaded('offline-map-123')).toBe(false);
        expect(mockExtracts.has('offline-map-123')).toBe(false);
    });

    it('should reuse singleton IDBDatabase connection across multiple operations', async () => {
        expect(openSpy).not.toHaveBeenCalled();
        await openDB();
        expect(openSpy).toHaveBeenCalledTimes(1);
        await openDB();
        await openDB();
        expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('treats a map as complete only when an extract file exists', async () => {
        await saveMapOffline({
            id: 'map-1',
            name: 'One',
            ownerId: 'u1',
            layers: [],
            pins: [],
            totalTiles: 100,
            completedTiles: 100,
        } as any);
        await saveMapOffline({
            id: 'map-2',
            name: 'Two',
            ownerId: 'u1',
            layers: [],
            pins: [],
            totalTiles: 50,
            completedTiles: 10,
        } as any);

        mockExtracts.add('map-1');

        const stats1 = await getDownloadStats('map-1');
        expect(stats1).toEqual({ total: 100, completed: 100 });
        const stats2 = await getDownloadStats('map-2');
        expect(stats2).toEqual({ total: 50, completed: 10 });

        const statuses = await getMapDownloadStatuses();
        expect(statuses.get('map-1')).toEqual({ isComplete: true, isPartial: false });
        expect(statuses.get('map-2')).toEqual({ isComplete: false, isPartial: true });

        mockExtracts.add('map-2');
        const statusesAfterExtract = await getMapDownloadStatuses();
        expect(statusesAfterExtract.get('map-2')).toEqual({ isComplete: true, isPartial: false });

        const filtered = await getMapDownloadStatuses(['map-1']);
        expect(filtered.get('map-1')).toEqual({ isComplete: true, isPartial: false });
        expect(filtered.has('map-2')).toBe(false);
    });

    it('treats a started extract with no completed tiles as a partial download', async () => {
        await saveMapOffline({
            id: 'map-zero',
            name: 'Zero',
            ownerId: 'u1',
            layers: [],
            pins: [],
            totalTiles: 100,
            completedTiles: 0,
        } as any);

        const statuses = await getMapDownloadStatuses(['map-zero']);
        expect(statuses.get('map-zero')).toEqual({ isComplete: false, isPartial: true });
    });

    it('treats a leftover .part file as a partial download even without tile counts', async () => {
        mockPartSizes.set('map-part-only', 80);
        mockMetaBytes.set('map-part-only', 200);
        const statuses = await getMapDownloadStatuses(['map-part-only']);
        expect(statuses.get('map-part-only')).toEqual({ isComplete: false, isPartial: true });

        await saveMapOffline({
            id: 'map-part-only',
            name: 'Part',
            ownerId: 'u1',
            layers: [],
            pins: [],
            totalTiles: 100,
            completedTiles: 0,
            extractTotalBytes: 200,
        } as any);
        const stats = await getDownloadStats('map-part-only');
        expect(stats).toEqual({ total: 100, completed: 40 });
    });

    it('clears leftover tile and manifest IndexedDB stores when removeAllDownloads is called', async () => {
        await saveMapOffline({
            id: 'map-clear-1',
            name: 'Clear Test Map',
            ownerId: 'u1',
            layers: [],
            pins: [],
        } as any);
        mockExtracts.add('map-clear-1');

        stores.get('maps');
        const tileStore = stores.has('tiles') ? stores.get('tiles')! : (() => {
            const m = new Map();
            stores.set('tiles', m);
            return m;
        })();
        const manifestStore = stores.has('manifest') ? stores.get('manifest')! : (() => {
            const m = new Map();
            stores.set('manifest', m);
            return m;
        })();
        tileStore.set('/maps/tile/1/0/0.mvt', new Uint8Array([1, 2, 3]));
        manifestStore.set('/maps/tile/1/0/0.mvt', { url: '/maps/tile/1/0/0.mvt', status: 'completed' });

        expect(await isMapDownloaded('map-clear-1')).toBe(true);
        await removeAllDownloads();

        expect(await isMapDownloaded('map-clear-1')).toBe(false);
        expect(mockExtracts.size).toBe(0);
        expect(stores.has('tiles')).toBe(false);
        expect(stores.has('manifest')).toBe(false);
        expect((global as any).indexedDB.deleteDatabase).toHaveBeenCalled();
    });
});

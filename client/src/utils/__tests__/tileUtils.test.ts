import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getYRange, getPinsBoundingBox, countTiles, getXRanges, saveMapOffline, saveMapToViewCache, getOfflineMap, isMapDownloaded, removeMapDownload, removeAllDownloads, getDownloadStats, getMapDownloadStatuses, resetDBForTesting, openDB, stripMapCachePii, unionCachedMapsWithDownloads, updateDownloadedMapDocument, bumpDownloadDocumentEpoch, currentDownloadDocumentEpoch, touchMapCacheAccess, claimUnownedMapDocuments, getMapETag } from '../tileUtils';
import { noteSignedInAccount, noteSignedOut, resetAccountScopeForTests } from '../accountScope';
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
    let deletedStores: string[];

    beforeEach(() => {
        resetAccountScopeForTests();
        resetDBForTesting();
        mockExtracts.clear();
        mockPartSizes.clear();
        mockMetaBytes.clear();
        stores = new Map<string, Map<any, any>>();
        deletedStores = [];
        const getStore = (name: string) => {
            if (!stores.has(name)) stores.set(name, new Map());
            return stores.get(name)!;
        };
        openSpy = vi.fn(() => {
            const req: any = {
                result: {
                    objectStoreNames: { contains: (name: string) => name === 'maps' || name === 'tiles' || name === 'manifest' || stores.has(name) },
                    deleteObjectStore: (name: string) => { deletedStores.push(name); },
                    transaction: () => {
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
                        setTimeout(() => tx.oncomplete && tx.oncomplete());
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
        const ranges = getXRanges(179.9, -179.9, 1);
        expect(ranges.length).toBeGreaterThan(0);
        ranges.forEach(([start, end]) => {
            expect(start).toBeGreaterThanOrEqual(0);
            expect(end).toBeLessThan(2);
        });
    });

    it('should clamp latitude for tile coordinates', () => {
        const [yStart, yEnd] = getYRange(89, 84, 5);
        expect(yStart).toBeGreaterThanOrEqual(0);
        expect(yEnd).toBeLessThan(32);
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

        for (let z = 1; z <= 15; z++) {
            expect(countTiles(bbox, z, z)).toBeGreaterThan(0);
        }
    });

    it('should generate and count full bounding box coverage for zooms 1 to 15', () => {
        const pins: Pin[] = [
            { id: '1', lat: 20.88, lng: -156.51, label: 'Maui Pin', position: 0 },
            { id: '2', lat: 19.72, lng: -155.11, label: 'Big Island Pin', position: 1 }
        ] as any;
        const bbox = getPinsBoundingBox(pins)!;

        const count = countTiles(bbox, 1, 15);
        const z15Count = countTiles(bbox, 15, 15);
        expect(z15Count).toBeGreaterThan(0);
        expect(count).toBeGreaterThan(z15Count);
    });

    it('should correctly handle antimeridian crossing in getXRanges and tile count', () => {
        const ranges = getXRanges(179, -179, 3);
        expect(ranges.length).toBe(2);
        expect(ranges[0][0]).toBe(7);
        expect(ranges[0][1]).toBe(7);
        expect(ranges[1][0]).toBe(0);
        expect(ranges[1][1]).toBe(0);

        const bboxCross = { north: 10, south: -10, west: 179, east: -179 };
        expect(countTiles(bboxCross, 2, 2)).toBeGreaterThan(0);
    });

    it('should include contextual buffer around bounding box at intermediate zoom levels 5 to 9', () => {
        const bbox = { north: 40.75, south: 40.74, east: -73.98, west: -73.99 };
        expect(countTiles(bbox, 6, 6)).toBe(25);
        expect(countTiles(bbox, 7, 7)).toBe(25);
        expect(countTiles(bbox, 8, 8)).toBe(25);
        expect(countTiles(bbox, 9, 9)).toBe(9);
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

    it('strips owner and collaborator fields from offline map snapshots', async () => {
        await saveMapOffline({
            id: 'pii-map',
            name: 'PII Map',
            ownerId: 'user-1',
            ownerName: 'Owner',
            ownerEmail: 'owner@example.com',
            ownerPicture: 'https://example.com/a.png',
            permissions: [{ userId: 'u2', userEmail: 'a@b.c', userName: 'A', role: 'edit' }],
            layers: [],
            pins: [],
            userRole: 'owner',
            isPublic: true,
        } as any);

        const retrieved = await getOfflineMap('pii-map');
        expect(retrieved?.name).toBe('PII Map');
        expect(retrieved?.userRole).toBe('owner');
        expect(retrieved?.isPublic).toBe(true);
        expect(retrieved).not.toHaveProperty('permissions');
        expect(retrieved).not.toHaveProperty('ownerId');
        expect(retrieved).not.toHaveProperty('ownerName');
        expect(retrieved).not.toHaveProperty('ownerEmail');
        expect(retrieved).not.toHaveProperty('ownerPicture');

        expect(stripMapCachePii({
            id: 'x',
            name: 'X',
            ownerId: 'u',
            ownerEmail: 'e@e.e',
            permissions: [],
            layers: [],
            pins: [],
        } as any)).toEqual({
            id: 'x',
            name: 'X',
            layers: [],
            pins: [],
        });
    });

    it('view-cache writes preserve explicit-download progress without collaborator PII', async () => {
        await saveMapOffline({
            id: 'dl-map',
            name: 'DL',
            ownerId: 'u1',
            layers: [],
            pins: [],
            totalTiles: 100,
            completedTiles: 40,
            extractTotalBytes: 2000,
        } as any);

        await saveMapToViewCache({
            id: 'dl-map',
            name: 'DL Updated',
            ownerEmail: 'owner@example.com',
            permissions: [{ userId: 'u2', userEmail: 'a@b.c', userName: 'A', role: 'view' }],
            layers: [],
            pins: [{ id: 'p1', lat: 1, lng: 2, label: 'P', position: 0 }],
            userRole: 'owner',
        } as any, '"etag-1"');

        const retrieved = await getOfflineMap('dl-map') as any;
        expect(retrieved.name).toBe('DL Updated');
        expect(retrieved.pins).toHaveLength(1);
        expect(retrieved.isExplicitDownload).toBe(true);
        expect(retrieved.etag).toBe('"etag-1"');
        expect(retrieved.totalTiles).toBe(100);
        expect(retrieved.completedTiles).toBe(40);
        expect(retrieved.extractTotalBytes).toBe(2000);
        expect(retrieved).not.toHaveProperty('permissions');
        expect(retrieved).not.toHaveProperty('ownerEmail');
    });

    it('patches an explicit download in place and ignores a view-cache row', async () => {
        expect(currentDownloadDocumentEpoch()).toBe(0);
        expect(bumpDownloadDocumentEpoch()).toBe(1);

        const missed = await updateDownloadedMapDocument('missing-map', {
            name: 'Nope',
            layers: [],
            pins: [],
        });
        expect(missed).toBe(false);
        expect(await getOfflineMap('missing-map')).toBeNull();

        await saveMapToViewCache({
            id: 'view-only',
            name: 'View',
            layers: [],
            pins: [],
        } as any);
        const viewWrite = await updateDownloadedMapDocument('view-only', {
            name: 'Changed',
            layers: [{ id: 'l1', name: 'Layer 1', position: 0 }],
            pins: [{ id: 'p1', lat: 1, lng: 2, label: 'P', position: 0 }],
        });
        expect(viewWrite).toBe(false);
        const viewRecord = await getOfflineMap('view-only') as any;
        expect(viewRecord.name).toBe('View');
        expect(viewRecord.pins).toEqual([]);
        expect(viewRecord.isExplicitDownload).toBe(false);

        await saveMapOffline({
            id: 'dl-patch',
            name: 'Before',
            layers: [],
            pins: [{ id: 'seed', lat: 10, lng: 10, label: 'Seed', position: 0 }],
            totalTiles: 12,
            completedTiles: 12,
            extractTotalBytes: 999,
        } as any);
        await saveMapToViewCache({
            id: 'dl-patch',
            name: 'Before',
            layers: [],
            pins: [{ id: 'seed', lat: 10, lng: 10, label: 'Seed', position: 0 }],
        } as any, '"etag-keep"');

        const wrote = await updateDownloadedMapDocument('dl-patch', {
            name: 'After',
            layers: [{ id: 'l1', name: 'Layer 1', position: 0 }],
            pins: [
                { id: 'seed', lat: 10, lng: 10, label: 'Seed', position: 0 },
                { id: 'far', lat: 64, lng: 25, label: 'Far', position: 1 },
            ],
        });
        expect(wrote).toBe(true);
        const patched = await getOfflineMap('dl-patch') as any;
        expect(patched.name).toBe('After');
        expect(patched.layers).toEqual([{ id: 'l1', name: 'Layer 1', position: 0 }]);
        expect(patched.pins.map((pin: { label: string }) => pin.label)).toEqual(['Seed', 'Far']);
        expect(patched.isExplicitDownload).toBe(true);
        expect(patched.etag).toBe('"etag-keep"');
        expect(patched.totalTiles).toBe(12);
        expect(patched.completedTiles).toBe(12);
        expect(patched.extractTotalBytes).toBe(999);
    });

    it('unions complete extracts missing from cached_maps onto the offline list', async () => {
        await saveMapOffline({
            id: 'extract-only',
            name: 'Extract Only',
            layers: [],
            pins: [],
        } as any);
        await saveMapOffline({
            id: 'cached-too',
            name: 'Also Cached',
            layers: [],
            pins: [],
        } as any);
        mockExtracts.add('extract-only');

        const cached = [
            { id: 'cached-too', name: 'From Cache', ownerId: 'u1', ownerName: 'User' },
        ];
        const merged = await unionCachedMapsWithDownloads(cached);
        expect(merged.map((m) => m.id)).toEqual(['extract-only', 'cached-too']);
        expect(merged[0].name).toBe('Extract Only');
        expect(merged[1].name).toBe('From Cache');
    });

    it('deletes leftover tiles and manifest stores on database upgrade', async () => {
        await openDB();
        expect(deletedStores).toEqual(['tiles', 'manifest']);
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

    it('touchMapCacheAccess updates lastAccessedAt in both localStorage and IndexedDB', async () => {
        localStorage.setItem('cached_maps', JSON.stringify([
            { id: 'map-lru-1', name: 'Map 1', lastAccessedAt: '2020-01-01T00:00:00.000Z' },
            { id: 'map-lru-2', name: 'Map 2', lastAccessedAt: '2020-01-01T00:00:00.000Z' }
        ]));

        await saveMapOffline({
            id: 'map-lru-1',
            name: 'Map 1',
            ownerId: 'u1',
            layers: [],
            pins: [],
        } as any);

        await touchMapCacheAccess('map-lru-1');

        const cached = JSON.parse(localStorage.getItem('cached_maps') || '[]');
        const map1 = cached.find((m: any) => m.id === 'map-lru-1');
        const map2 = cached.find((m: any) => m.id === 'map-lru-2');
        expect(map1.lastAccessedAt).not.toBe('2020-01-01T00:00:00.000Z');
        expect(new Date(map1.lastAccessedAt).getTime()).toBeGreaterThan(new Date('2025-01-01').getTime());
        expect(map2.lastAccessedAt).toBe('2020-01-01T00:00:00.000Z');

        const mapStore = stores.get('maps');
        expect(mapStore?.get('map-lru-1')?.lastAccessedAt).toBeGreaterThan(0);
    });

    it('touchMapCacheAccess adds new map to cached_maps if summary fallback is provided', async () => {
        localStorage.setItem('cached_maps', JSON.stringify([
            { id: 'map-existing', name: 'Existing Map', lastAccessedAt: '2020-01-01T00:00:00.000Z' }
        ]));

        await touchMapCacheAccess('map-new', { name: 'Brand New Map', ownerId: 'u2' });

        const cached = JSON.parse(localStorage.getItem('cached_maps') || '[]');
        expect(cached).toHaveLength(2);
        expect(cached[0].id).toBe('map-new');
        expect(cached[0].name).toBe('Brand New Map');
        expect(cached[0].lastAccessedAt).toBeTruthy();
    });

    it('keeps an offline map for the account that saved it', async () => {
        const doc = { id: 'acct-map', name: 'Secret', layers: [], pins: [] };
        noteSignedInAccount('user-a');
        await saveMapOffline(doc as any);
        mockExtracts.add('acct-map');

        noteSignedInAccount('user-b');
        expect(await getOfflineMap('acct-map')).toBeNull();
        expect(await getMapETag('acct-map')).toBeNull();
        await removeMapDownload('acct-map');
        expect(mockExtracts.has('acct-map')).toBe(true);

        noteSignedOut();
        expect(await getOfflineMap('acct-map')).toBeNull();

        noteSignedInAccount('user-a');
        expect((await getOfflineMap('acct-map'))?.name).toBe('Secret');
        expect(mockExtracts.has('acct-map')).toBe(true);
        await removeMapDownload('acct-map');
        expect(await getOfflineMap('acct-map')).toBeNull();
        expect(mockExtracts.has('acct-map')).toBe(false);
    });

    it('detaches only the active account from a shared offline copy', async () => {
        noteSignedInAccount('user-a');
        await saveMapOffline({ id: 'both-map', name: 'Shared', layers: [], pins: [] } as any);
        mockExtracts.add('both-map');
        noteSignedInAccount('user-b');
        await saveMapToViewCache({ id: 'both-map', name: 'Shared', layers: [], pins: [] } as any);
        await removeMapDownload('both-map');
        expect(await getOfflineMap('both-map')).toBeNull();
        expect(mockExtracts.has('both-map')).toBe(true);

        noteSignedInAccount('user-a');
        expect((await getOfflineMap('both-map'))?.name).toBe('Shared');
        await removeAllDownloads();
        expect(mockExtracts.has('both-map')).toBe(false);
        expect((global as any).indexedDB.deleteDatabase).not.toHaveBeenCalled();
        noteSignedInAccount('user-b');
        expect(await getOfflineMap('both-map')).toBeNull();
    });

    it('claims unsigned documents for the previous account when a different person signs in', async () => {
        await saveMapOffline({ id: 'orphan-map', name: 'Orphan', layers: [], pins: [] } as any);
        await claimUnownedMapDocuments('user-b', 'user-a');
        noteSignedInAccount('user-b');
        expect(await getOfflineMap('orphan-map')).toBeNull();
        noteSignedInAccount('user-a');
        expect((await getOfflineMap('orphan-map'))?.name).toBe('Orphan');
    });
});

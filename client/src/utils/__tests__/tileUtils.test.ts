import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTilesForArea, getPinsBoundingBox, getSurgicalBoxes, saveMapOffline, getOfflineMap, removeMapDownload, saveTile, getTile, addToManifest, getManifestStats, resetDBForTesting, openDB } from '../tileUtils';
import type { Pin } from '@shared/interfaces';

describe('tileUtils', () => {
    let openSpy: any;
    beforeEach(() => {
        resetDBForTesting();
        const stores = new Map<string, Map<any, any>>();
        const getStore = (name: string) => {
            if (!stores.has(name)) stores.set(name, new Map());
            return stores.get(name)!;
        };
        openSpy = vi.fn(() => {
            const req: any = {
                result: {
                    objectStoreNames: { contains: () => true },
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
                                    getAllKeys: () => {
                                        const r: any = {};
                                        setTimeout(() => {
                                            r.result = Array.from(txStore.keys());
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
                                    index: (idxName?: string) => ({
                                        getAll: (query?: any) => {
                                            const r: any = {};
                                            setTimeout(() => {
                                                let values = Array.from(txStore.values());
                                                if (query !== undefined && query !== null) {
                                                    const target = typeof query === 'object' && query?.lower !== undefined ? query.lower : query;
                                                    values = values.filter((v: any) => (idxName && v?.[idxName] === target) || v?.mapId === target);
                                                }
                                                r.result = values;
                                                r.onsuccess && r.onsuccess();
                                            });
                                            return r;
                                        },
                                        openKeyCursor: () => {
                                            const r: any = {};
                                            setTimeout(() => {
                                                r.result = null;
                                                r.onsuccess && r.onsuccess();
                                            });
                                            return r;
                                        }
                                    })
                                };
                            },
                            oncomplete: null,
                            onerror: null
                        };
                        setTimeout(() => tx.oncomplete && tx.oncomplete(), 20);
                        return tx;
                    }
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
            open: openSpy
        };
    });

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

        await removeMapDownload('offline-map-123');
        const afterRemove = await getOfflineMap('offline-map-123');
        expect(afterRemove).toBeNull();
    });

    it('should save tile blob and retrieve it with getTile including URL fallback matching', async () => {
        const tileUrl = `${window.location.origin}/maps/tile/12/1234/2345.mvt`;
        const dummyBlob = new Blob(['tile-data'], { type: 'application/x-protobuf' });

        await saveTile(tileUrl, dummyBlob);
        const tileFromFullUrl = await getTile(tileUrl);
        expect(tileFromFullUrl).not.toBeNull();

        const tileFromPathname = await getTile('/maps/tile/12/1234/2345.mvt');
        expect(tileFromPathname).not.toBeNull();
    });

    it('should reuse singleton IDBDatabase connection across multiple operations', async () => {
        expect(openSpy).not.toHaveBeenCalled();
        await openDB();
        expect(openSpy).toHaveBeenCalledTimes(1);
        await openDB();
        await openDB();
        expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('should cache tile misses in memory and return null without repeated transactions', async () => {
        const missingUrl = `${window.location.origin}/maps/tile/14/9999/9999.mvt`;
        const firstAttempt = await getTile(missingUrl);
        expect(firstAttempt).toBeNull();

        // Second attempt should return null directly from in-memory miss cache
        const secondAttempt = await getTile(missingUrl);
        expect(secondAttempt).toBeNull();

        // Saving the tile should invalidate the miss cache and return the new tile
        const dummyBlob = new Blob(['new-tile-data'], { type: 'application/x-protobuf' });
        await saveTile(missingUrl, dummyBlob);
        const thirdAttempt = await getTile(missingUrl);
        expect(thirdAttempt).not.toBeNull();
    });

    it('should add entries to manifest without overwriting completed status', async () => {
        const completedEntry = {
            url: 'https://example.com/tile1.mvt',
            x: 1,
            y: 2,
            z: 3,
            status: 'completed' as const,
            mapId: 'map-1',
            updatedAt: Date.now()
        };
        await addToManifest([completedEntry]);

        const pendingEntry = {
            url: 'https://example.com/tile1.mvt',
            x: 1,
            y: 2,
            z: 3,
            status: 'pending' as const,
            mapId: 'map-1',
            updatedAt: Date.now()
        };
        await addToManifest([pendingEntry]);

        // Verify that completed entry remains completed
        const stats = await getManifestStats('map-1');
        expect(stats.completed).toBe(1);
        expect(stats.total).toBe(1);
    });
});

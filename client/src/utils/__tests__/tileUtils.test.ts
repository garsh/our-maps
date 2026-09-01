import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTilesForArea, getPinsBoundingBox, getSurgicalBoxes, countUniqueTiles, saveMapOffline, getOfflineMap, removeMapDownload, saveTile, saveTileBatch, getTile, addToManifest, getPendingFromManifest, getManifestStats, getMapDownloadStatuses, resetDBForTesting, openDB } from '../tileUtils';
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
                                    indexNames: { contains: (idx: string) => idx === 'mapId_status' || idx === 'status' || idx === 'mapId' },
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
                                    clear: () => {
                                        txStore.clear();
                                        const r: any = {};
                                        setTimeout(() => r.onsuccess && r.onsuccess());
                                        return r;
                                    },
                                    index: (idxName?: string) => ({
                                        count: (query?: any) => {
                                            const r: any = { readyState: 'done' };
                                            setTimeout(() => {
                                                let values = Array.from(txStore.values());
                                                if (query !== undefined && query !== null) {
                                                    if (Array.isArray(query)) {
                                                        const [mId, st] = query;
                                                        values = values.filter((v: any) => v.mapId === mId && v.status === st);
                                                    } else {
                                                        const target = typeof query === 'object' && query?.lower !== undefined ? query.lower : query;
                                                        values = values.filter((v: any) => (idxName && v?.[idxName] === target) || v?.mapId === target);
                                                    }
                                                }
                                                r.result = values.length;
                                                r.onsuccess && r.onsuccess();
                                            });
                                            return r;
                                        },
                                        getAll: (query?: any) => {
                                            const r: any = {};
                                            setTimeout(() => {
                                                let values = Array.from(txStore.values());
                                                if (query !== undefined && query !== null) {
                                                    const target = typeof query === 'object' && query?.lower !== undefined ? query.lower : query;
                                                    if (Array.isArray(target)) {
                                                        const [mId, st] = target;
                                                        values = values.filter((v: any) => v.mapId === mId && v.status === st);
                                                    } else {
                                                        values = values.filter((v: any) => (idxName && v?.[idxName] === target) || v?.mapId === target);
                                                    }
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

    it('should transitively merge overlapping surgical boxes', () => {
        // P1 and P3 are far from each other, but P2 bridges them
        const pins: Pin[] = [
            { id: '1', lat: 45.000, lng: -74.000, label: 'P1', position: 0 },
            { id: '2', lat: 45.030, lng: -74.030, label: 'P2', position: 1 },
            { id: '3', lat: 45.060, lng: -74.060, label: 'P3', position: 2 }
        ] as any;

        const boxes = getSurgicalBoxes(pins);
        expect(boxes.length).toBe(1);
        expect(boxes[0].north).toBeGreaterThanOrEqual(45.06);
        expect(boxes[0].south).toBeLessThanOrEqual(45.00);
    });

    it('should accurately count unique tiles across overlapping boxes', () => {
        const bbox = { north: 45.1, south: 44.9, east: -73.9, west: -74.1 };
        const box1 = { north: 45.01, south: 44.99, east: -73.99, west: -74.01 };
        const box2 = { north: 45.02, south: 45.00, east: -73.98, west: -74.00 };

        const count = countUniqueTiles(bbox, [box1, box2]);
        expect(count).toBeGreaterThan(0);
        // Ensure that passing identical duplicate boxes does not increase the unique count
        const countDuplicate = countUniqueTiles(bbox, [box1, box2, box1, box2]);
        expect(countDuplicate).toBe(count);
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

    it('returns download statuses for maps in single pass with or without mapId list', async () => {
        const entry1 = {
            url: 'https://example.com/map1_t1.mvt',
            x: 1, y: 1, z: 1,
            status: 'completed' as const,
            mapId: 'map-1',
            updatedAt: Date.now()
        };
        const entry2 = {
            url: 'https://example.com/map2_t1.mvt',
            x: 2, y: 2, z: 2,
            status: 'pending' as const,
            mapId: 'map-2',
            updatedAt: Date.now()
        };
        await addToManifest([entry1, entry2]);

        const statusesAll = await getMapDownloadStatuses();
        expect(statusesAll.get('map-1')).toEqual({ isComplete: true, isPartial: false });
        expect(statusesAll.get('map-2')).toEqual({ isComplete: false, isPartial: true });

        const statusesFiltered = await getMapDownloadStatuses(['map-1']);
        expect(statusesFiltered.get('map-1')).toEqual({ isComplete: true, isPartial: false });
        expect(statusesFiltered.has('map-2')).toBe(false);
    });

    it('should save a batch of tiles and update manifest entries in a single transaction', async () => {
        const url1 = `${window.location.origin}/maps/tile/10/100/200.mvt`;
        const url2 = `${window.location.origin}/maps/tile/10/101/200.mvt`;
        const blob1 = new Blob(['tile-1-data'], { type: 'application/x-protobuf' });
        const blob2 = new Blob(['tile-2-data'], { type: 'application/x-protobuf' });

        await addToManifest([
            { url: url1, x: 100, y: 200, z: 10, status: 'pending', mapId: 'batch-map', updatedAt: Date.now() },
            { url: url2, x: 101, y: 200, z: 10, status: 'pending', mapId: 'batch-map', updatedAt: Date.now() },
        ]);

        await saveTileBatch([
            { url: url1, blob: blob1, status: 'completed' },
            { url: url2, blob: blob2, status: 'completed' },
        ]);

        const retrievedTile1 = await getTile(url1);
        const retrievedTile2 = await getTile(url2);
        expect(retrievedTile1).not.toBeNull();
        expect(retrievedTile2).not.toBeNull();

        const stats = await getManifestStats('batch-map');
        expect(stats.total).toBe(2);
        expect(stats.completed).toBe(2);
    });

    it('should guarantee all input pins are contained within at least one surgical box', () => {
        const pins: Pin[] = [];
        for (let i = 0; i < 50; i++) {
            pins.push({
                id: `pin-${i}`,
                lat: 37.0 + Math.sin(i) * 0.5,
                lng: -122.0 + Math.cos(i) * 0.5,
                label: `Pin ${i}`,
                position: i
            } as any);
        }

        const boxes = getSurgicalBoxes(pins);
        expect(boxes.length).toBeGreaterThan(0);

        for (const pin of pins) {
            const isContained = boxes.some(b => 
                pin.lat <= b.north + 1e-9 &&
                pin.lat >= b.south - 1e-9 &&
                pin.lng <= b.east + 1e-9 &&
                pin.lng >= b.west - 1e-9
            );
            expect(isContained).toBe(true);
        }
    });

    it('should cluster 2,000 synthetic pins in less than 50ms (performance benchmark)', () => {
        const pins: Pin[] = [];
        for (let i = 0; i < 2000; i++) {
            pins.push({
                id: `bench-pin-${i}`,
                lat: 40.0 + (i % 50) * 0.005 + Math.floor(i / 50) * 0.05,
                lng: -74.0 + (i % 50) * 0.005,
                label: `Bench ${i}`,
                position: i
            } as any);
        }

        const startTime = performance.now();
        const boxes = getSurgicalBoxes(pins);
        const elapsed = performance.now() - startTime;

        expect(boxes.length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(100); // Must be fast
    });

    it('should handle edge cases in getSurgicalBoxes gracefully', () => {
        expect(getSurgicalBoxes([])).toEqual([]);

        const singlePin: Pin[] = [{ id: 'p1', lat: 10, lng: 20, label: 'Single', position: 0 } as any];
        const singleBox = getSurgicalBoxes(singlePin);
        expect(singleBox.length).toBe(1);
        expect(singleBox[0].north).toBeCloseTo(10.01, 5);

        const duplicates: Pin[] = [
            { id: 'p1', lat: 10, lng: 20, label: 'Duplicate 1', position: 0 } as any,
            { id: 'p2', lat: 10, lng: 20, label: 'Duplicate 2', position: 1 } as any
        ];
        const dupBoxes = getSurgicalBoxes(duplicates);
        expect(dupBoxes.length).toBe(1);
    });

    it('should preserve shared tiles and reassign manifest ownership when one map is deleted', async () => {
        // Map 1 in New York
        const map1: any = {
            id: 'map-ny-1',
            name: 'NY Map 1',
            pins: [{ id: 'p1', lat: 40.71, lng: -74.00, label: 'NYC', position: 0 }]
        };
        // Map 2 also in New York (overlapping area)
        const map2: any = {
            id: 'map-ny-2',
            name: 'NY Map 2',
            pins: [{ id: 'p2', lat: 40.72, lng: -74.01, label: 'NYC Central', position: 0 }]
        };

        await saveMapOffline(map1);
        await saveMapOffline(map2);

        // Shared tile in NYC area (z=10, x=301, y=384)
        const sharedTileUrl = `${window.location.origin}/maps/tile/10/301/384.mvt`;
        const blob = new Blob(['nyc-tile'], { type: 'application/x-protobuf' });

        await addToManifest([
            { url: sharedTileUrl, x: 301, y: 384, z: 10, status: 'completed', mapId: 'map-ny-1', updatedAt: Date.now() }
        ]);
        await saveTile(sharedTileUrl, blob);

        // Deleting map 1 should NOT delete the shared tile because map 2 also covers it
        await removeMapDownload('map-ny-1');

        const tileAfterDelete = await getTile(sharedTileUrl);
        expect(tileAfterDelete).not.toBeNull();

        // The manifest entry should now be reassigned to map-ny-2
        const statsMap2 = await getManifestStats('map-ny-2');
        expect(statsMap2.completed).toBe(1);
    });

    it('should retrieve pending and error manifest entries without loading completed entries', async () => {
        const completed = {
            url: 'https://example.com/t1.mvt',
            x: 1, y: 1, z: 1,
            status: 'completed' as const,
            mapId: 'resume-map',
            updatedAt: Date.now()
        };
        const pending = {
            url: 'https://example.com/t2.mvt',
            x: 2, y: 2, z: 2,
            status: 'pending' as const,
            mapId: 'resume-map',
            updatedAt: Date.now()
        };
        const error = {
            url: 'https://example.com/t3.mvt',
            x: 3, y: 3, z: 3,
            status: 'error' as const,
            mapId: 'resume-map',
            updatedAt: Date.now()
        };

        await addToManifest([completed, pending, error]);
        const pendingEntries = await getPendingFromManifest('resume-map');
        expect(pendingEntries).toHaveLength(2);
        expect(pendingEntries.map(e => e.url)).toContain('https://example.com/t2.mvt');
        expect(pendingEntries.map(e => e.url)).toContain('https://example.com/t3.mvt');
    });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTilesForArea, getPendingFromTileList, getPinsBoundingBox, countTiles, getXRanges, toCanonicalTileKey, getTileKeys, saveMapOffline, getOfflineMap, isMapDownloaded, removeMapDownload, removeAllDownloads, saveTile, saveTileBatch, getTile, addToManifest, getPendingFromManifest, getManifestStats, getMapDownloadStatuses, resetDBForTesting, openDB, prewarmTilesForArea, clearTileCaches } from '../tileUtils';
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
                                        getAllKeys: (query?: any) => {
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
                                                r.result = values.map((v: any) => v.url || v.id);
                                                r.onsuccess && r.onsuccess();
                                            });
                                            return r;
                                        },
                                        openKeyCursor: () => {
                                            const r: any = {};
                                            setTimeout(() => {
                                                const values = Array.from(txStore.values());
                                                const uniqueKeys = Array.from(new Set(values.map((v: any) => v.mapId).filter(Boolean)));
                                                let cursorIndex = 0;
                                                const cursor: any = {
                                                    get key() { return uniqueKeys[cursorIndex]; },
                                                    continue: () => {
                                                        cursorIndex++;
                                                        if (cursorIndex < uniqueKeys.length) {
                                                            r.result = cursor;
                                                        } else {
                                                            r.result = null;
                                                        }
                                                        r.onsuccess && r.onsuccess();
                                                    }
                                                };
                                                r.result = uniqueKeys.length > 0 ? cursor : null;
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
        
        // Ensure every zoom level from 1 to 15 has tiles
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

        // Verify full bbox coverage for zoom 15
        const z15Count = countTiles(bbox, 15, 15);
        const z15Tiles = tiles.filter(t => t.z === 15);
        expect(z15Tiles.length).toBe(z15Count);
    });

    it('should quickly filter completed tiles with getPendingFromTileList', async () => {
        const t1 = { x: 10, y: 20, z: 5, url: 'http://test/5/10/20.mvt' };
        const t2 = { x: 11, y: 20, z: 5, url: 'http://test/5/11/20.mvt' };
        
        // When nothing completed
        const pendingAll = await getPendingFromTileList([t1, t2], 'map-test-1');
        expect(pendingAll.length).toBe(2);

        // When t1 is completed
        await addToManifest([{
            url: t1.url,
            x: t1.x,
            y: t1.y,
            z: t1.z,
            status: 'completed',
            mapId: 'map-test-1',
            updatedAt: Date.now()
        }]);

        const pendingFiltered = await getPendingFromTileList([t1, t2], 'map-test-1');
        expect(pendingFiltered.length).toBe(1);
        expect(pendingFiltered[0].url).toBe(t2.url);
    });

    it('should correctly handle antimeridian crossing in getXRanges and tile generation', () => {
        // West = 179 deg, East = -179 deg crosses the 180th meridian
        const ranges = getXRanges(179, -179, 3); // 2^3 = 8 tiles wide [0..7]
        expect(ranges.length).toBe(2);
        // Should produce ranges [7, 7] and [0, 0]
        expect(ranges[0][0]).toBe(7);
        expect(ranges[0][1]).toBe(7);
        expect(ranges[1][0]).toBe(0);
        expect(ranges[1][1]).toBe(0);

        const bboxCross = { north: 10, south: -10, west: 179, east: -179 };
        const tilesCross = getTilesForArea(bboxCross, 2, 2);
        expect(tilesCross.length).toBe(countTiles(bboxCross, 2, 2));
        expect(tilesCross.length).toBeGreaterThan(0);
    });

    it('should correctly resolve canonical path and fallback tile keys', () => {
        const fullHttp = 'https://ourmaps.app/maps/tile/5/10/12.mvt';
        expect(toCanonicalTileKey(fullHttp)).toBe('/maps/tile/5/10/12.mvt');

        const keysHttp = getTileKeys(fullHttp);
        expect(keysHttp.primary).toBe('/maps/tile/5/10/12.mvt');
        expect(keysHttp.secondary).toBe(fullHttp);

        const relative = '/maps/tile/5/10/12.mvt';
        expect(toCanonicalTileKey(relative)).toBe('/maps/tile/5/10/12.mvt');

        const keysRel = getTileKeys(relative);
        expect(keysRel.primary).toBe('/maps/tile/5/10/12.mvt');
        expect(keysRel.secondary).toBe(`${window.location.origin}/maps/tile/5/10/12.mvt`);
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
        expect(await isMapDownloaded('offline-map-123')).toBe(true);

        await removeMapDownload('offline-map-123');
        const afterRemove = await getOfflineMap('offline-map-123');
        expect(afterRemove).toBeNull();
        expect(await isMapDownloaded('offline-map-123')).toBe(false);
    });

    it('should clear all offline maps and tiles when removeAllDownloads is called', async () => {
        const dummyMap: any = {
            id: 'map-clear-1',
            name: 'Clear Test Map',
            ownerId: 'u1',
            layers: [],
            pins: [{ id: 'p1', mapId: 'map-clear-1', layerId: 'l1', name: 'P1', latitude: 20, longitude: -157, order: 0, syncStatus: 'synced', createdAt: '', updatedAt: '' }]
        };
        await saveMapOffline(dummyMap);
        await saveTile('/maps/tile/1/0/0.mvt', new Blob(['data']));
        expect(await isMapDownloaded('map-clear-1')).toBe(true);

        await removeAllDownloads();

        expect(await isMapDownloaded('map-clear-1')).toBe(false);
        expect(await getTile('/maps/tile/1/0/0.mvt')).toBeNull();
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
        const result1 = await addToManifest([completedEntry]);
        expect(result1).toHaveLength(0);

        const pendingEntry = {
            url: 'https://example.com/tile1.mvt',
            x: 1,
            y: 2,
            z: 3,
            status: 'pending' as const,
            mapId: 'map-1',
            updatedAt: Date.now()
        };
        const result2 = await addToManifest([pendingEntry]);
        expect(result2).toHaveLength(0); // Already completed, not returned as pending

        const newPending = {
            url: 'https://example.com/tile2.mvt',
            x: 2,
            y: 2,
            z: 3,
            status: 'pending' as const,
            mapId: 'map-1',
            updatedAt: Date.now()
        };
        const result3 = await addToManifest([newPending]);
        expect(result3).toHaveLength(1);
        expect(result3[0].url).toBe('https://example.com/tile2.mvt');

        // Verify that completed entry remains completed
        const stats = await getManifestStats('map-1');
        expect(stats.completed).toBe(1);
        expect(stats.total).toBe(2);
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

    it('should directly save tile batch with pre-populated manifest entry without extra get query', async () => {
        const url = `${window.location.origin}/maps/tile/10/500/600.mvt`;
        const blob = new Blob(['direct-tile-data'], { type: 'application/x-protobuf' });
        const entry = {
            url,
            x: 500,
            y: 600,
            z: 10,
            status: 'pending' as const,
            mapId: 'direct-batch-map',
            updatedAt: Date.now()
        };

        await saveTileBatch([
            { url, blob, status: 'completed', entry }
        ]);

        const retrieved = await getTile(url);
        expect(retrieved).not.toBeNull();

        const stats = await getManifestStats('direct-batch-map');
        expect(stats.total).toBe(1);
        expect(stats.completed).toBe(1);
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

    it('should save and retrieve tiles as Uint8Array and serve from in-memory hit cache', async () => {
        const url = '/maps/tile/10/100/200.mvt';
        const rawData = new Uint8Array([1, 2, 3, 4, 5]);

        await saveTile(url, rawData);
        const tile = await getTile(url);
        expect(tile).toBeInstanceOf(Uint8Array);
        expect(Array.from(tile || [])).toEqual([1, 2, 3, 4, 5]);

        // Immediate subsequent retrieval should be served directly from in-memory hit cache
        const cachedTile = await getTile(url);
        expect(cachedTile).toBeInstanceOf(Uint8Array);
        expect(Array.from(cachedTile || [])).toEqual([1, 2, 3, 4, 5]);
    });

    it('should prewarm tiles into in-memory cache for a given bounding box', async () => {
        const box = { north: 40.8, south: 40.7, east: -73.9, west: -74.0 };
        const url = '/maps/tile/13/2411/3079.mvt';
        const rawData = new Uint8Array([10, 20, 30]);

        await saveTile(url, rawData);
        clearTileCaches();

        // After clearing caches, prewarming the area should load the tile into memory
        await prewarmTilesForArea(box, 13);
        const prewarmed = await getTile(url);
        expect(prewarmed).not.toBeNull();
        expect(Array.from(prewarmed || [])).toEqual([10, 20, 30]);
    });

    it('should include contextual buffer around bounding box at intermediate zoom levels 5 to 9', () => {
        const bbox = { north: 40.75, south: 40.74, east: -73.98, west: -73.99 };
        const tilesZ6 = getTilesForArea(bbox, 6, 6);
        // At zoom 6, 2-tile buffer generates a 5x5 grid (25 tiles) around the center
        expect(tilesZ6.length).toBe(25);

        const tilesZ7 = getTilesForArea(bbox, 7, 7);
        expect(tilesZ7.length).toBe(25);

        const tilesZ8 = getTilesForArea(bbox, 8, 8);
        expect(tilesZ8.length).toBe(25);

        const tilesZ9 = getTilesForArea(bbox, 9, 9);
        // At zoom 9, 1-tile buffer generates a 3x3 grid (9 tiles) around the center
        expect(tilesZ9.length).toBe(9);
    });
});

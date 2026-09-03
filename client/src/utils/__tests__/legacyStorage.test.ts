import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    isKnownCacheName,
    isKnownIndexedDbName,
    isKnownLocalStorageKey,
    isKnownOpfsEntry,
    findUnrecognizedStorage,
    deleteUnrecognizedStorage,
    type LeftoverStorageItem,
} from '../legacyStorage';

describe('legacyStorage classification', () => {
    it('recognizes storage the current app still uses', () => {
        expect(isKnownIndexedDbName('MapTilesDB_v2')).toBe(true);
        expect(isKnownOpfsEntry('offline-extracts')).toBe(true);
        expect(isKnownCacheName('api-cache')).toBe(true);
        expect(isKnownCacheName('elevation-tiles-cache')).toBe(true);
        expect(isKnownCacheName('workbox-precache-v2-https://example')).toBe(true);
        expect(isKnownLocalStorageKey('token')).toBe(true);
        expect(isKnownLocalStorageKey('cached_maps')).toBe(true);
        expect(isKnownLocalStorageKey('ourmaps_map_theme')).toBe(true);
        expect(isKnownLocalStorageKey('ourmaps_3d')).toBe(true);
        expect(isKnownLocalStorageKey('ourmaps_visibility_abc')).toBe(true);
        expect(isKnownLocalStorageKey('customColors')).toBe(true);
    });

    it('treats older names as unrecognized', () => {
        expect(isKnownIndexedDbName('MapTilesDB')).toBe(false);
        expect(isKnownIndexedDbName('MapTilesDB_v1')).toBe(false);
        expect(isKnownOpfsEntry('tiles')).toBe(false);
        expect(isKnownCacheName('leaflet-tiles')).toBe(false);
        expect(isKnownLocalStorageKey('theme')).toBe(false);
        expect(isKnownLocalStorageKey('offline_tiles')).toBe(false);
    });
});

describe('findUnrecognizedStorage', () => {
    beforeEach(() => {
        localStorage.clear();
        (global as any).indexedDB = {
            databases: vi.fn(async () => [
                { name: 'MapTilesDB_v2', version: 5 },
                { name: 'MapTilesDB', version: 1 },
            ]),
            deleteDatabase: vi.fn(),
        };
        (global as any).caches = {
            keys: vi.fn(async () => ['api-cache', 'workbox-precache-v2-abc', 'old-tile-cache']),
            delete: vi.fn(async () => true),
        };
        const entries = new Map<string, unknown>([
            ['offline-extracts', {}],
            ['old-pmtiles-cache', {}],
        ]);
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: {
                getDirectory: async () => ({
                    keys: async function* () {
                        for (const name of entries.keys()) yield name;
                    },
                    removeEntry: vi.fn(async (name: string) => { entries.delete(name); }),
                }),
            },
        });
        localStorage.setItem('token', 'abc');
        localStorage.setItem('cached_maps', '[]');
        localStorage.setItem('stale_tile_index', '1');
    });

    it('reports only storage the current version does not use', async () => {
        const leftovers = await findUnrecognizedStorage();
        const details = leftovers.map((item) => item.detail).sort();
        expect(details).toEqual([
            'Old cached map data (old-tile-cache)',
            'Old map database (MapTilesDB)',
            'Old map files (old-pmtiles-cache)',
            'Old saved setting (stale_tile_index)',
        ].sort());
        expect(leftovers.find((item) => item.name === 'MapTilesDB_v2')).toBeUndefined();
        expect(leftovers.find((item) => item.name === 'offline-extracts')).toBeUndefined();
        expect(leftovers.find((item) => item.name === 'token')).toBeUndefined();
    });
});

describe('deleteUnrecognizedStorage', () => {
    it('deletes each leftover by kind', async () => {
        const deleteDatabase = vi.fn(() => {
            const req: any = {};
            setTimeout(() => req.onsuccess && req.onsuccess());
            return req;
        });
        (global as any).indexedDB = { deleteDatabase };
        const cacheDelete = vi.fn(async () => true);
        (global as any).caches = { delete: cacheDelete };
        const removeEntry = vi.fn(async () => {});
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: { getDirectory: async () => ({ removeEntry }) },
        });
        localStorage.setItem('stale_tile_index', '1');

        const items: LeftoverStorageItem[] = [
            { id: 'indexeddb:MapTilesDB', kind: 'indexeddb', name: 'MapTilesDB', detail: 'Old map database (MapTilesDB)' },
            { id: 'opfs:old-pmtiles-cache', kind: 'opfs', name: 'old-pmtiles-cache', detail: 'Old map files (old-pmtiles-cache)' },
            { id: 'cache:old-tile-cache', kind: 'cache', name: 'old-tile-cache', detail: 'Old cached map data (old-tile-cache)' },
            { id: 'localStorage:stale_tile_index', kind: 'localStorage', name: 'stale_tile_index', detail: 'Old saved setting (stale_tile_index)' },
        ];

        await deleteUnrecognizedStorage(items);
        expect(deleteDatabase).toHaveBeenCalledWith('MapTilesDB');
        expect(removeEntry).toHaveBeenCalledWith('old-pmtiles-cache', { recursive: true });
        expect(cacheDelete).toHaveBeenCalledWith('old-tile-cache');
        expect(localStorage.getItem('stale_tile_index')).toBeNull();
    });
});

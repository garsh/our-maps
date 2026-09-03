import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getExtractFile } = vi.hoisted(() => ({
    getExtractFile: vi.fn(),
}));

vi.mock('../extractStore', () => ({
    getExtractFile,
    invalidateExtractCache: vi.fn(),
}));

vi.mock('pmtiles', () => ({
    PMTiles: class {
        source: { file?: File; mapId?: string };
        constructor(source: { file?: File; mapId?: string }) { this.source = source; }
        async getZxy() {
            return { data: new Uint8Array([1, 2, 3]) };
        }
        async getHeader() {
            return {
                minZoom: 1,
                maxZoom: 15,
                minLon: -180,
                minLat: -85,
                maxLon: 180,
                maxLat: 85,
                numAddressedTiles: 1,
                numTileEntries: 1,
                clustered: true,
                tileCompression: 2,
                specVersion: 3,
            };
        }
    }
}));

import { setActiveOfflineMapId, getActiveExtractPMTiles, getExtractTileJSON, invalidateExtractPMTiles } from '../offlineExtract';

describe('offlineExtract', () => {
    beforeEach(() => {
        invalidateExtractPMTiles();
        setActiveOfflineMapId(null);
        getExtractFile.mockReset();
    });

    it('returns null when no map is active', async () => {
        expect(await getActiveExtractPMTiles()).toBeNull();
        expect(getExtractFile).not.toHaveBeenCalled();
    });

    it('loads a PMTiles instance from the active map extract', async () => {
        setActiveOfflineMapId('map-1');
        getExtractFile.mockResolvedValue(new File([new Uint8Array(200)], 'map-1.pmtiles'));
        const first = await getActiveExtractPMTiles();
        expect(first).not.toBeNull();
        const second = await getActiveExtractPMTiles();
        expect(second).toBe(first);
        expect(getExtractFile).toHaveBeenCalledTimes(1);
    });

    it('returns null when the extract file is missing', async () => {
        setActiveOfflineMapId('map-missing');
        getExtractFile.mockResolvedValue(null);
        expect(await getActiveExtractPMTiles()).toBeNull();
    });

    it('builds TileJSON from the local extract header', async () => {
        setActiveOfflineMapId('map-1');
        getExtractFile.mockResolvedValue(new File([new Uint8Array(200)], 'map-1.pmtiles'));
        const json = await getExtractTileJSON('pmtiles://https://example/maps/planet.pmtiles');
        expect(json).toEqual({
            tiles: ['pmtiles://https://example/maps/planet.pmtiles/{z}/{x}/{y}'],
            minzoom: 1,
            maxzoom: 15,
            bounds: [-180, -85, 180, 85],
        });
        expect(json?.minzoom).toBe(1);
        expect(json?.maxzoom).toBe(15);
    });

    it('keeps the active map id when it is set again to the same value', async () => {
        setActiveOfflineMapId('map-1');
        getExtractFile.mockResolvedValue(new File([new Uint8Array(200)], 'map-1.pmtiles'));
        await getActiveExtractPMTiles();
        setActiveOfflineMapId('map-1');
        expect(await getActiveExtractPMTiles()).not.toBeNull();
        expect(getExtractFile).toHaveBeenCalledTimes(1);
    });
});

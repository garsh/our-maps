import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as maplibregl from 'maplibre-gl';
import MapView, {
  isPinInPaddedViewport,
  syncOfflineTerrain,
  resetDEMInflightForTests,
} from '../MapView';
import { getHoveredPinId, setHoveredPin, resetPinHoverForTests } from '../../utils/pinHover';
import { getMapViewportBounds, resetMapViewportBoundsForTests } from '../../utils/mapViewport';

const { capturedMapProps, capturedSourceProps } = vi.hoisted(() => ({
  capturedMapProps: { current: null as any },
  capturedSourceProps: { current: [] as any[] },
}));

// Mock react-map-gl/maplibre
const mockEaseTo = vi.fn();
const mockFlyTo = vi.fn();
const mockFitBounds = vi.fn();
const mockGetZoom = vi.fn(() => 10);
const mockGetBearing = vi.fn(() => 0);
const mockGetPitch = vi.fn(() => 0);
const mockProject = vi.fn(() => ({ x: 500, y: 400 }));
const mockGetContainer = vi.fn(() => ({
  getBoundingClientRect: () => ({ width: 1000, height: 800 }),
  clientWidth: 1000,
  clientHeight: 800,
}));
const mockGetBounds = vi.fn(() => ({
  getNorthWest: () => ({ lat: 40, lng: -70 }),
  getSouthEast: () => ({ lat: 30, lng: -80 }),
  getWest: () => -80,
  getNorth: () => 40,
  getEast: () => -70,
  getSouth: () => 30,
  contains: () => true,
}));

const mockResize = vi.fn();
const mockTriggerRepaint = vi.fn();
const mockJumpTo = vi.fn();
const mockPanBy = vi.fn();
const mockUnproject = vi.fn((point: [number, number]) => ({
  lng: -80 + (point[0] / 1000) * 10,
  lat: 40 - (point[1] / 800) * 10,
}));
const mockIsWebGLContextLost = vi.fn(() => false);
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockCanvasAddEventListener = vi.fn();
const mockCanvasRemoveEventListener = vi.fn();
const mockSetLayoutProperty = vi.fn();

const mockMapInstance = {
  getMap: () => ({
    getZoom: mockGetZoom,
    getBearing: mockGetBearing,
    getPitch: mockGetPitch,
    getBounds: mockGetBounds,
    project: mockProject,
    getContainer: mockGetContainer,
    getCanvas: () => ({
      style: {},
      addEventListener: mockCanvasAddEventListener,
      removeEventListener: mockCanvasRemoveEventListener,
      getContext: vi.fn(),
    }),
    easeTo: mockEaseTo,
    flyTo: mockFlyTo,
    jumpTo: mockJumpTo,
    panBy: mockPanBy,
    unproject: mockUnproject,
    fitBounds: mockFitBounds,
    setTerrain: vi.fn(),
    triggerRepaint: mockTriggerRepaint,
    hasImage: vi.fn(() => false),
    addImage: vi.fn(),
    setMissingStyleImageResolver: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    isMoving: vi.fn(() => false),
    isWebGLContextLost: mockIsWebGLContextLost,
    resize: mockResize,
    on: mockOn,
    off: mockOff,
    once: vi.fn(),
    getLayer: vi.fn((id: string) => ({ id })),
    setLayoutProperty: mockSetLayoutProperty,
    getCenter: vi.fn(() => ({ lat: 10, lng: 20 })),
  }),
  getZoom: mockGetZoom,
  getBearing: mockGetBearing,
  getPitch: mockGetPitch,
  getBounds: mockGetBounds,
  easeTo: mockEaseTo,
  flyTo: mockFlyTo,
  fitBounds: mockFitBounds,
};

vi.mock('react-map-gl/maplibre', () => {
  return {
    default: (props: any) => {
      capturedMapProps.current = props;
      const { children, onLoad, ref } = props;
      if (typeof ref === 'function') {
        ref(mockMapInstance);
      } else if (ref && 'current' in ref) {
        ref.current = mockMapInstance;
      }
      // Trigger onLoad after render
      setTimeout(() => {
        onLoad?.({ target: mockMapInstance.getMap() });
      }, 0);
      return <div data-testid="react-map-gl-mock">{children}</div>;
    },
    Marker: ({ children }: any) => <div data-testid="marker-mock">{children}</div>,
    Source: (props: any) => {
      capturedSourceProps.current.push(props);
      return <div data-testid="source-mock">{props.children}</div>;
    },
    Layer: () => null,
    AttributionControl: () => null,
  };
});

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: 'blob:http://localhost/maplibre-worker',
}));

vi.mock('maplibre-gl', () => {
  class LngLat {
    lng: number;
    lat: number;
    constructor(lng: number, lat: number) {
      this.lng = Number(lng);
      this.lat = Number(lat);
    }
    wrap() {
      return this;
    }
    toArray() {
      return [this.lng, this.lat];
    }
    static convert(input: any) {
      if (input instanceof LngLat) return input;
      if (Array.isArray(input)) return new LngLat(input[0], input[1]);
      return new LngLat(input.lng, input.lat);
    }
  }

  return {
    setWorkerUrl: vi.fn(),
    addProtocol: vi.fn(),
    LngLat,
  };
});

vi.mock('pmtiles', () => ({
  Protocol: class {
    tilev4 = vi.fn();
  },
}));

describe('syncOfflineTerrain', () => {
  it('enables and disables terrain based on show3DTerrain and allows tileManager.maxzoom up to 22', () => {
    const mockMap = {
      setTerrain: vi.fn(),
      getTerrain: vi.fn(() => null),
      terrain: {
        tileManager: { maxzoom: 22 },
      },
    };

    // When show3DTerrain is true and terrain not currently active
    syncOfflineTerrain(mockMap, true);
    expect(mockMap.setTerrain).toHaveBeenCalledWith({ source: 'terrainElevation', exaggeration: 1.0 });
    expect(mockMap.terrain.tileManager.maxzoom).toBe(22);

    // When show3DTerrain is true and terrain is already active
    mockMap.getTerrain.mockReturnValue({ source: 'terrainElevation' } as any);
    mockMap.setTerrain.mockClear();
    syncOfflineTerrain(mockMap, true);
    expect(mockMap.setTerrain).not.toHaveBeenCalled();
    expect(mockMap.terrain.tileManager.maxzoom).toBe(22);

    // When show3DTerrain is false and terrain is active
    syncOfflineTerrain(mockMap, false);
    expect(mockMap.setTerrain).toHaveBeenCalledWith(null);
  });

  it('patches _getDEMTileMatrix to calculate parent DEM overzoom accurately', () => {
    const mockMap = {
      setTerrain: vi.fn(),
      getTerrain: vi.fn(() => ({ source: 'terrainElevation' })),
      terrain: {
        tileManager: { maxzoom: 22 },
        _getDEMTileMatrix: vi.fn(() => 'unpatched'),
        _demMatrixCache: new Map(),
        _elevationSamplerCache: new Map(),
      },
    };

    syncOfflineTerrain(mockMap, true);
    expect((mockMap.terrain as any)._originalGetDEMTileMatrix).toBeDefined();

    // Test matrix calculation when sourceTile is parent DEM tile (e.g. z=14) and tileID is z=18
    const tileID = {
      key: '18/52503/100655',
      canonical: { z: 18, x: 52503, y: 100655 },
      overscaledZ: 19,
    };
    const sourceTile = {
      tileID: { key: '14/3281/6290', canonical: { z: 14, x: 3281, y: 6290 } },
    };

    const matrix = (mockMap.terrain as any)._getDEMTileMatrix(tileID, sourceTile);
    expect(matrix).toBeInstanceOf(Float64Array);
    // dz = 18 - 14 = 4. Scale = 1 / (8192 * 16)
    expect(matrix[0]).toBeCloseTo(1 / (8192 * 16), 10);
    expect(matrix[5]).toBeCloseTo(1 / (8192 * 16), 10);
    // dx = 52503 % 16 = 7. Translation X = 7 / 16
    expect(matrix[12]).toBeCloseTo(7 / 16, 10);
    // dy = 100655 % 16 = 15. Translation Y = 15 / 16
    expect(matrix[13]).toBeCloseTo(15 / 16, 10);

    // Test that safe bilinear sampling protection is applied to DEMData prototype
    const mockProto = {
      sampleBilinear: vi.fn((x: number, y: number) => ({ x, y })),
    };
    const demObj = Object.create(mockProto);
    demObj.dim = 256;
    (mockMap.terrain as any)._getDEMTileMatrix(tileID, { ...sourceTile, dem: demObj });
    expect((mockProto as any)._safeSampleBilinear).toBeDefined();
    // Testing clamping for coordinates out of bounds
    demObj.sampleBilinear(300, -5);
    expect(mockProto._safeSampleBilinear).toHaveBeenCalledWith(256 - 1e-4, -1);

    // Test matrix calculation when tileID has a fractional canonical.z (from MapLibre's getElevationForLngLatZoom)
    const floatTileID = {
      key: '18.64/52503/100655',
      canonical: { z: 18.64, x: 52503, y: 100655 },
      overscaledZ: 18.64,
    };
    const floatMatrix = (mockMap.terrain as any)._getDEMTileMatrix(floatTileID, sourceTile);
    // dz must be floored to 18 - 14 = 4 (not 4.64), preserving integer power of 2
    expect(floatMatrix[0]).toBeCloseTo(1 / (8192 * 16), 10);
    expect(floatMatrix[12]).toBeCloseTo(7 / 16, 10);
    expect(floatMatrix[13]).toBeCloseTo(15 / 16, 10);
  });

  it('stabilizes camera against zoom jumping and empty-delta repositioning in deep terrain', () => {
    const mockCameraProto = {
      _elevateCameraIfInsideTerrain: vi.fn(() => ({ pitch: 0, zoom: 16.98 })),
      _finalizeElevation: vi.fn(),
      _afterEase: vi.fn(),
      easeTo: vi.fn(),
      applyUpdatedTransform: vi.fn(),
    };
    const mockCamera = Object.create(mockCameraProto);
    mockCamera.elevationFreeze = true;
    mockCamera.getCenterClampedToGround = vi.fn(() => true);
    mockCamera.terrain = {
      getElevationForLngLatZoom: vi.fn(() => 3250),
    };

    const mockCameraHelperProto = {
      handleMapControlsPan: vi.fn(),
    };
    const mockCameraHelper = Object.create(mockCameraHelperProto);
    mockCamera.cameraHelper = mockCameraHelper;

    const mockHandlersProto = {
      _updateMapTransform: vi.fn(),
      _terrainGestureElevation: vi.fn(() => 3250),
      _handleMapControls: vi.fn(),
      _fireEvents: vi.fn(),
    };
    const mockHandlers = Object.create(mockHandlersProto);
    mockHandlers._camera = mockCamera;
    mockHandlers._terrainMovement = true;
    mockHandlers._eventsInProgress = { zoom: { handlerName: 'scrollZoom' } };
    mockHandlers._handlersById = { scrollZoom: { isActive: () => false } };

    const mockHelperProto = {
      recalculateZoomAndCenter: vi.fn(function (this: any, elevation: number) {
        this.elevation = elevation;
        this.setZoom(16.98); // simulates MapLibre changing zoom
        this._center = { lng: -107.0, lat: 38.0 }; // simulates MapLibre shifting center
      }),
      setCenter: vi.fn(function (this: any, c: any) { this._center = c; }),
      setElevation: vi.fn(function (this: any, e: number) { this.elevation = e; }),
    };
    const mockHelper = Object.create(mockHelperProto);
    mockHelper.zoom = 17.64;
    mockHelper.pitch = 0;
    mockHelper.center = { lng: -107.897, lat: 38.497 };
    mockHelper._center = { lng: -107.897, lat: 38.497 };
    mockHelper.elevation = 3200;
    mockHelper.setZoom = vi.fn(function (this: any, z: number) { this.zoom = z; });

    const mockTrProto = {
      recalculateZoomAndCenter: vi.fn(function (this: any, _terrain?: any) {
        this.elevation = 3250;
        this.zoom = 16.98;
        this.center = { lng: -107.0, lat: 38.0 };
      }),
      setCenter: vi.fn(function (this: any, c: any) { this.center = c; }),
      setElevation: vi.fn(function (this: any, e: number) { this.elevation = e; this._elevation = e; }),
      setZoom: vi.fn(function (this: any, z: number) { this.zoom = z; }),
    };
    const mockTr = Object.create(mockTrProto);
    mockTr.zoom = 17.64;
    mockTr.pitch = 0;
    mockTr.center = { lng: -107.897, lat: 38.497 };
    mockTr.elevation = 3200;
    mockTr._elevation = 3200;
    mockTr._helper = mockHelper;
    mockTr.centerPoint = { x: 500, y: 400, distSqr: (p: any) => (p.x - 500) ** 2 + (p.y - 400) ** 2 };
    mockCamera.transform = mockTr;

    const mockTtmProto = {
      releaseRTT: vi.fn(),
    };
    const mockTileManager = Object.create(mockTtmProto);
    mockTileManager.maxzoom = 22;
    mockTileManager._tiles = {};

    const mockRttProto = {
      prepareForRender: vi.fn(),
    };
    const mockRtt = Object.create(mockRttProto);

    const mockTerrain = {
      tileManager: mockTileManager,
      _getOverscaledTileIDFromLngLatZoom: vi.fn((_lnglat: any, z: number) => ({ tileID: { canonical: { z } } })),
      getElevationForLngLatZoom: vi.fn(() => 3250),
    };

    const mockMap = {
      setTerrain: vi.fn(),
      getTerrain: vi.fn(() => ({ source: 'terrainElevation' })),
      terrain: mockTerrain,
      _camera: mockCamera,
      _handlers: mockHandlers,
      transform: mockTr,
      painter: {
        renderToTexture: mockRtt,
      },
      triggerRepaint: vi.fn(),
    };
    mockTileManager.map = mockMap;

    syncOfflineTerrain(mockMap, true);
    expect(mockCameraProto._stableElevateCameraIfInsideTerrain).toBeDefined();
    expect(mockCameraProto._stableApplyUpdatedTransform).toBeDefined();
    expect(mockCameraProto._stableFinalizeElevation).toBeDefined();
    expect(mockTtmProto._stableReleaseRTT).toBeDefined();
    expect(mockRttProto._stablePrepareForRender).toBeDefined();
    expect(mockTrProto._stableRecalculateZoomAndCenter).toBeDefined();
    expect(mockTrProto._stableSetElevation).toBeDefined();
    expect(mockHelperProto._stableRecalculateZoomAndCenter).toBeDefined();
    expect(mockCameraHelperProto._stableHandleMapControlsPan).toBeDefined();
    expect(mockHandlersProto._stableUpdateMapTransform).toBeDefined();
    expect(mockHandlersProto._stableTerrainGestureElevation).toBeDefined();
    expect(mockHandlersProto._stableHandleMapControls).toBeDefined();
    expect((mockTerrain as any)._originalGetOverscaledTileIDFromLngLatZoom).toBeDefined();

    // Verify _getOverscaledTileIDFromLngLatZoom floors fractional zoom
    (mockTerrain as any)._getOverscaledTileIDFromLngLatZoom({ lng: 0, lat: 0 }, 18.64);
    expect((mockTerrain as any)._originalGetOverscaledTileIDFromLngLatZoom).toHaveBeenCalledWith({ lng: 0, lat: 0 }, 18);

    // 1. In top-down mode (pitch < 45), camera altitude below terrain should elevate without forcing zoom back
    const trTopDown = {
      pitch: 0,
      zoom: 17.5,
      elevation: 3200,
      getCameraLngLat: () => [-107.7, 37.8],
      getCameraAltitude: () => 3210, // lower than terrain elevation (3250)
    };
    const result = mockCamera._elevateCameraIfInsideTerrain(trTopDown);
    expect(result).toEqual({ elevation: 3250 });
    expect(result.zoom).toBeUndefined();

    // 2. recalculateZoomAndCenter on transform & helper should update elevation directly in top-down view (pitch < 60) without mutating zoom or center
    mockHelper.recalculateZoomAndCenter(3201.7);
    expect(mockHelperProto.setElevation).toHaveBeenCalledWith(3201.7);
    expect(mockHelper.zoom).toBe(17.64);
    expect(mockHelper.center).toEqual({ lng: -107.897, lat: 38.497 });

    mockTr.recalculateZoomAndCenter(mockTerrain);
    expect(mockTerrain.getElevationForLngLatZoom).toHaveBeenCalledWith({ lng: -107.897, lat: 38.497 }, 17);
    expect(mockTrProto._stableSetElevation).toHaveBeenCalledWith(3250);
    expect(mockTr.zoom).toBe(17.64);
    expect(mockTr.center).toEqual({ lng: -107.897, lat: 38.497 });

    // 3. handleMapControlsPan ignores empty deltas (finish timeout) and center-point around anchor, but applies valid zoomDelta or panDelta
    mockCameraHelper.handleMapControlsPan({}, mockTr, {});
    expect(mockCameraHelperProto._stableHandleMapControlsPan).not.toHaveBeenCalled();

    mockCameraHelper.handleMapControlsPan({ zoomDelta: 0.1, around: { x: 500.001, y: 400.001, distSqr: () => 0.000002 } }, mockTr, {});
    expect(mockCameraHelperProto._stableHandleMapControlsPan).not.toHaveBeenCalled();

    mockCameraHelper.handleMapControlsPan({ zoomDelta: 0.1, around: { x: 600, y: 400, distSqr: () => 10000 } }, mockTr, {});
    expect(mockCameraHelperProto._stableHandleMapControlsPan).toHaveBeenCalled();

    // 4. _updateMapTransform does not mutate camera when no deltas exist, but fires events directly.
    // The terrain&&_terrainMovement passthrough from upstream is intentionally NOT restored —
    // on zero-delta terrain frames, passing through would call _camera.stop(true) and kill inertia.
    mockHandlers._updateMapTransform({}, { zoom: false }, {});
    expect(mockHandlersProto._stableUpdateMapTransform).not.toHaveBeenCalled();
    expect(mockHandlersProto._stableFireEvents).toHaveBeenCalledWith({ zoom: false }, {}, true);

    mockHandlers._updateMapTransform({ zoomDelta: 0.2 }, { zoom: true }, {});
    expect(mockHandlersProto._stableUpdateMapTransform).toHaveBeenCalledWith({ zoomDelta: 0.2 }, { zoom: true }, {});

    // 5. _finalizeElevation clears elevationFreeze without calling recalculateZoomAndCenter when pitch < 60
    expect(mockCameraProto._stableFinalizeElevation).toBeDefined();
    mockCamera.elevationFreeze = true;
    mockCamera._finalizeElevation();
    expect(mockCamera.elevationFreeze).toBe(false);
    expect(mockCameraProto._stableFinalizeElevation).not.toHaveBeenCalled();

    // 6. releaseRTT invalidates overscaled terrain tiles (z >= 16) when canonical parent vector tile (z = 15) loads
    const mockReleaseRTT = vi.fn();
    const mockTerrainTile = {
      tileID: {
        wrap: 0,
        canonical: {
          z: 16,
          x: 100,
          y: 200,
          equals: (other: any) => other.z === 16 && other.x === 100 && other.y === 200,
          isChildOf: (other: any) => other.z === 15 && other.x === 50 && other.y === 100,
        },
        overscaledZ: 16,
      },
      releaseRTT: mockReleaseRTT,
    };
    mockTileManager._tiles = { '16/100/200': mockTerrainTile };
    const vectorTileID = {
      wrap: 0,
      canonical: {
        z: 15,
        x: 50,
        y: 100,
        equals: () => false,
        isChildOf: () => false,
      },
      overscaledZ: 16,
    };
    mockMap.triggerRepaint.mockClear();
    mockTileManager.releaseRTT(vectorTileID);
    expect(mockReleaseRTT).toHaveBeenCalledWith(mockMap.painter);
    expect(mockMap.triggerRepaint).toHaveBeenCalled();

    // 7. _fireEvents clears _terrainMovement and elevationFreeze when finishedMoving occurs without recalculating zoom/center
    expect(mockHandlersProto._stableFireEvents).toBeDefined();
    mockHandlers._terrainMovement = true;
    mockCamera.elevationFreeze = true;
    mockHandlers._camera._requestedCameraState = {};
    mockHandlers._fireEvents({}, {}, true);
    expect(mockHandlers._terrainMovement).toBe(false);
    expect(mockCamera.elevationFreeze).toBe(false);
    expect(mockHandlers._camera._requestedCameraState).toBeUndefined();
    expect(mockHandlersProto._stableFireEvents).toHaveBeenCalled();

    // 8. _terrainGestureElevation bypasses ray-plane solve for pitch < 60 pure zoom to prevent lateral jitter
    expect(mockHandlersProto._stableTerrainGestureElevation).toBeDefined();
    expect(mockHandlers._terrainGestureElevation(mockTerrain, { x: 600, y: 400 }, true, mockTr, { zoom: true, drag: false })).toBeUndefined();
    expect(mockHandlersProto._stableTerrainGestureElevation).not.toHaveBeenCalled();

    // At pitch >= 60, it delegates to stable terrain gesture elevation
    const mockTrPitched = { ...mockTr, pitch: 70 };
    mockHandlers._terrainGestureElevation(mockTerrain, { x: 600, y: 400 }, true, mockTrPitched, { zoom: true, drag: false });
    expect(mockHandlersProto._stableTerrainGestureElevation).toHaveBeenCalled();

    // 9. _handleMapControls unfreezes elevation during pure zoom so elevation updates continuously
    expect(mockHandlersProto._stableHandleMapControls).toBeDefined();
    mockCamera.elevationFreeze = true;
    mockHandlers._handleMapControls({ combinedEventsInProgress: { zoom: true, drag: false } });
    expect(mockCamera.elevationFreeze).toBe(false);

    // 10. setElevation eases sudden elevation changes (> 0.05m) when idle to prevent single-frame vertical pops
    mockHandlers._terrainMovement = false;
    mockTr._elevation = 3200;
    mockMap.triggerRepaint.mockClear();
    mockTr.setElevation(3204);
    expect(mockTrProto._stableSetElevation).toHaveBeenCalledWith(3200.5);
    expect(mockMap.triggerRepaint).toHaveBeenCalled();

    // Small elevation changes (<= 0.05m) apply directly
    mockTr._elevation = 3200;
    mockTr.setElevation(3200.02);
    expect(mockTrProto._stableSetElevation).toHaveBeenCalledWith(3200.02);
  });
});

describe('dem protocol handler', () => {
  afterEach(() => {
    resetDEMInflightForTests();
    vi.unstubAllGlobals();
  });

  it('registers dem protocol and throws 404 for uncached offline tiles and z > 15 to allow parent overzooming', async () => {
    const demCall = (maplibregl.addProtocol as any).mock.calls.find((call: any[]) => call[0] === 'dem');
    expect(demCall).toBeDefined();
    const handler = demCall[1];

    // z > 15 throws 404
    await expect(handler({ url: 'dem://https://s3.amazonaws.com/elevation-tiles-prod/terrarium/16/100/200.png' }, new AbortController()))
      .rejects.toMatchObject({ status: 404, message: expect.stringContaining('Tile not found: 16/100/200') });

    // uncached tile offline throws 404
    await expect(handler({ url: 'dem://https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/6562/12582.png' }, new AbortController()))
      .rejects.toMatchObject({ status: 404, message: expect.stringContaining('Tile not found: 15/6562/12582') });

    // aborted request throws AbortError cleanly
    const abortedController = new AbortController();
    abortedController.abort();
    await expect(handler({ url: 'dem://https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/6562/12582.png' }, abortedController))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('coalesces in-flight DEM fetches for the same URL', async () => {
    const demCall = (maplibregl.addProtocol as any).mock.calls.find((call: any[]) => call[0] === 'dem');
    const handler = demCall[1];
    const url = 'dem://https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/1/2.png';

    let resolveFetch: (value: any) => void;
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
    const fetchMock = vi.fn(() => fetchPromise);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { ...navigator, onLine: true });

    const p1 = handler({ url }, new AbortController());
    const p2 = handler({ url }, new AbortController());
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = new ArrayBuffer(8);
    resolveFetch!({
      ok: true,
      clone: () => ({ }),
      arrayBuffer: async () => body,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.data).toBe(body);
    expect(r2.data).toBe(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('isPinInPaddedViewport', () => {
  it('treats a pin under the sidebar padding as out of view', () => {
    const map = {
      project: () => ({ x: 100, y: 400 }),
      getContainer: () => ({
        getBoundingClientRect: () => ({ width: 1000, height: 800 }),
        clientWidth: 1000,
        clientHeight: 800,
      }),
    };
    expect(isPinInPaddedViewport(map, { lat: 10, lng: 20 }, 400, 0)).toBe(false);
    expect(isPinInPaddedViewport({ ...map, project: () => ({ x: 700, y: 400 }) }, { lat: 10, lng: 20 }, 400, 0)).toBe(true);
  });
});

describe('MapView Compass and Tilt Indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPinHoverForTests();
    resetMapViewportBoundsForTests();
    capturedMapProps.current = null;
  });

  afterEach(() => {
    resetPinHoverForTests();
    resetMapViewportBoundsForTests();
  });

  it('renders combined compass/tilt control and locator buttons in lower-right corner', () => {
    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
      />
    );

    const compassButton = screen.getByRole('button', { name: /Compass - Reset bearing to North/i });
    const locatorButton = screen.getByRole('button', { name: /Find my location/i });

    expect(compassButton).toBeInTheDocument();
    expect(locatorButton).toBeInTheDocument();
  });

  it('portals compass and location buttons into mobileControlsTarget on mobile', () => {
    const portalTarget = document.createElement('div');
    portalTarget.id = 'mobile-map-controls';
    document.body.appendChild(portalTarget);

    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
        isMobile={true}
        mobileControlsTarget={portalTarget}
      />
    );

    const compassButton = screen.getByRole('button', { name: /Compass - Reset bearing to North/i });
    const locatorButton = screen.getByRole('button', { name: /Find my location/i });

    expect(portalTarget.contains(compassButton)).toBe(true);
    expect(portalTarget.contains(locatorButton)).toBe(true);

    document.body.removeChild(portalTarget);
  });

  it('resets compass bearing and tilt when control button is clicked', () => {
    vi.useFakeTimers();
    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
      />
    );

    const compassButton = screen.getByRole('button', { name: /Compass - Reset bearing to North/i });
    fireEvent.click(compassButton);

    // Single-click action is deferred 300ms for double-click detection
    vi.advanceTimersByTime(300);

    expect(mockEaseTo).toHaveBeenCalledWith({ pitch: 60, duration: 300 });
    vi.useRealTimers();
  });

  it('centers a single pin with paddedMapView on double-click of compass', () => {
    const mockPins = [
      { id: 'pin-1', lat: 10, lng: 20, label: 'Single Pin', color: 'blue' as const, position: 0 }
    ];

    render(
      <MapView
        pins={mockPins}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
        leftPadding={0}
        bottomPadding={350}
      />
    );

    const compassButton = screen.getByRole('button', { name: /Compass - Reset bearing to North/i });
    fireEvent.click(compassButton);
    fireEvent.click(compassButton);

    expect(mockFlyTo).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [20, 10],
        zoom: 6,
        padding: {
          top: 80,
          left: 80,
          right: 80,
          bottom: 430,
        },
      })
    );
  });

  it('fits multiple pins with paddedMapView on double-click of compass', () => {
    const mockPins = [
      { id: 'pin-1', lat: 10, lng: 20, label: 'Pin 1', color: 'blue' as const, position: 0 },
      { id: 'pin-2', lat: 30, lng: 40, label: 'Pin 2', color: 'red' as const, position: 1 },
    ];

    render(
      <MapView
        pins={mockPins}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
        leftPadding={0}
        bottomPadding={350}
      />
    );

    const compassButton = screen.getByRole('button', { name: /Compass - Reset bearing to North/i });
    fireEvent.click(compassButton);
    fireEvent.click(compassButton);

    expect(mockFitBounds).toHaveBeenCalledWith(
      [
        [20, 10],
        [40, 30],
      ],
      expect.objectContaining({
        maxZoom: 13,
        padding: {
          top: 80,
          left: 80,
          right: 80,
          bottom: 430,
        },
      })
    );
  });

  it('triggers onHoverPin with pin.id on mouse enter and (null, pin.id) on mouse leave', () => {
    const mockOnHoverPin = vi.fn();
    const mockPins = [
      { id: 'pin-1', lat: 10, lng: 20, label: 'Test Pin', color: 'blue' as const, position: 0 }
    ];

    render(
      <MapView
        pins={mockPins}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
        onHoverPin={mockOnHoverPin}
      />
    );

    act(() => {
      capturedMapProps.current?.onMouseEnter?.({
        features: [{ layer: { id: 'pins-symbol-layer' }, properties: { id: 'pin-1' } }],
      });
    });
    expect(mockOnHoverPin).toHaveBeenCalledWith('pin-1');

    act(() => {
      capturedMapProps.current?.onMouseLeave?.();
    });
    expect(mockOnHoverPin).toHaveBeenCalledWith(null);
  });

  it('clears hover on pan via a stable onMove handler without React hover props', () => {
    const mockOnHoverPin = vi.fn();
    setHoveredPin('pin-1');

    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onHoverPin={mockOnHoverPin}
      />
    );

    expect(typeof capturedMapProps.current?.onMove).toBe('function');
    capturedMapProps.current.onMove();

    expect(getHoveredPinId()).toBeNull();
    expect(mockOnHoverPin).toHaveBeenCalledWith(null);
  });

  it('publishes viewport bounds once and skips duplicate strings', async () => {
    const onBoundsChange = vi.fn();

    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={onBoundsChange}
      />
    );

    await waitFor(() => {
      expect(onBoundsChange).toHaveBeenCalledWith('-80,40,-70,30');
    });
    expect(getMapViewportBounds()).toBe('-80,40,-70,30');

    capturedMapProps.current.onMoveEnd();
    expect(onBoundsChange).toHaveBeenCalledTimes(1);
  });

  it('does not start location tracking on initial mount', () => {
    const mockWatchPosition = vi.fn();
    Object.defineProperty(global.navigator, 'geolocation', {
      value: {
        watchPosition: mockWatchPosition,
        clearWatch: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
      />
    );

    expect(mockWatchPosition).not.toHaveBeenCalled();
  });

  it('toggles location tracking on and off when location button is clicked', () => {
    let watchSuccessCb: ((pos: any) => void) | null = null;
    const mockWatchPosition = vi.fn().mockImplementation((success) => {
      watchSuccessCb = success;
      return 12345;
    });
    const mockClearWatch = vi.fn();
    Object.defineProperty(global.navigator, 'geolocation', {
      value: {
        watchPosition: mockWatchPosition,
        clearWatch: mockClearWatch,
      },
      writable: true,
      configurable: true,
    });

    const onLocationTrackingChange = vi.fn();
    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
        onLocationTrackingChange={onLocationTrackingChange}
      />
    );

    const locatorButton = screen.getByRole('button', { name: /Find my location/i });
    expect(locatorButton).toHaveAttribute('aria-pressed', 'false');
    expect(onLocationTrackingChange).toHaveBeenCalledWith(false);

    fireEvent.click(locatorButton);

    expect(mockWatchPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Locating\.\.\./i })).toHaveAttribute('aria-pressed', 'true');
    expect(onLocationTrackingChange).toHaveBeenCalledWith(true);

    // Simulate geolocation lock
    act(() => {
      watchSuccessCb?.({
        coords: { latitude: 37.7749, longitude: -122.4194 },
      });
    });

    expect(screen.getByRole('button', { name: /Stop location tracking/i })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Stop location tracking/i }));

    expect(mockClearWatch).toHaveBeenCalledWith(12345);
    expect(screen.getByRole('button', { name: /Find my location/i })).toHaveAttribute('aria-pressed', 'false');
    expect(onLocationTrackingChange).toHaveBeenLastCalledWith(false);
  });

  it('points the vector source at pmtiles tile templates and skips remote sprite/glyph URLs', () => {
    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
      />
    );

    const style = capturedMapProps.current?.mapStyle;
    expect(style?.sprite).toBeUndefined();
    expect(style?.glyphs).toBeUndefined();
    expect(style?.sources?.protomaps?.url).toBeUndefined();
    expect(style?.sources?.protomaps?.tiles?.[0]).toMatch(/^pmtiles:\/\/.+\/\{z\}\/\{x\}\/\{y\}$/);
  });

  it('flies to a list-selected pin that sits under the sidebar padding', () => {
    mockProject.mockReturnValue({ x: 120, y: 400 });
    const mockPins = [
      { id: 'pin-1', lat: 10, lng: 20, label: 'Hidden Pin', color: 'blue' as const, position: 0 }
    ];

    const { rerender } = render(
      <MapView
        pins={mockPins}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        leftPadding={400}
      />
    );

    rerender(
      <MapView
        pins={mockPins}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        leftPadding={400}
        targetPinId="pin-1"
      />
    );

    expect(mockFlyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [20, 10],
      padding: expect.objectContaining({ left: 480 }),
    }));
  });

  it('triggers map resize and repaint when document becomes visible without context loss', () => {
    mockResize.mockClear();
    mockTriggerRepaint.mockClear();

    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
      />
    );

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockResize).toHaveBeenCalled();
    expect(mockTriggerRepaint).toHaveBeenCalled();
  });

  it('remounts map instance with fresh key and preserved viewState when WebGL context loss is detected', () => {
    mockResize.mockClear();
    mockTriggerRepaint.mockClear();

    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
      />
    );

    const initialId = capturedMapProps.current?.id;
    expect(initialId).toBe('map-session-0');

    // Simulate user panning to new coordinates
    act(() => {
      capturedMapProps.current.onMove({
        viewState: {
          longitude: -79.99,
          latitude: 40.44,
          zoom: 14.5,
          pitch: 30,
          bearing: 45,
        },
      });
    });

    // Simulate WebGL context loss
    mockIsWebGLContextLost.mockReturnValue(true);

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Map should have remounted with session id = map-session-1
    const remountedId = capturedMapProps.current?.id;
    expect(remountedId).toBe('map-session-1');

    // Initial view state on remount must preserve the panned position
    expect(capturedMapProps.current.initialViewState).toEqual({
      longitude: -79.99,
      latitude: 40.44,
      zoom: 14.5,
      pitch: 30,
      bearing: 45,
    });
  });

  it('slices vector tiles up to zoom 18 (zoomLevelsToOverscale=4) to prevent tile explosion at zoom 22', () => {
    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
      />
    );

    expect(capturedMapProps.current.maxZoom).toBe(22);
    expect(capturedMapProps.current.zoomLevelsToOverscale).toBe(4);
    expect(capturedMapProps.current.mapStyle?.sources?.protomaps?.maxzoom).toBe(15);
  });

  it('does not subscribe to per-tile sourcedata or data repaint handlers', () => {
    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
      />
    );

    const onEvents = mockOn.mock.calls.map((call) => call[0]);
    expect(onEvents).toContain('style.load');
    expect(onEvents).toContain('webglcontextlost');
    expect(onEvents).not.toContain('sourcedata');
    expect(onEvents).not.toContain('data');
  });

  it('configures pins-source with maxzoom=24 to ensure geojson-vt indexes features at high zoom', () => {
    capturedSourceProps.current = [];
    render(
      <MapView
        pins={[{ id: 'pin-1', lat: 38.4975, lng: -107.8975, title: 'Test Pin', color: 'red' } as any]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
      />
    );

    const pinsSource = capturedSourceProps.current.find((s: any) => s.id === 'pins-source');
    expect(pinsSource).toBeDefined();
    expect(pinsSource.maxzoom).toBe(24);
  });

  it('does not remount or jump the camera on orientationchange — App reloads MapView instead', () => {
    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        show3DTerrain={true}
        bottomPadding={350}
      />
    );

    expect(capturedMapProps.current?.id).toBe('map-session-0');
    mockJumpTo.mockClear();

    act(() => {
      window.dispatchEvent(new Event('orientationchange'));
    });

    expect(capturedMapProps.current?.id).toBe('map-session-0');
    expect(mockJumpTo).not.toHaveBeenCalled();
  });

  it('fits pins from scratch when MapView is remounted with a new key, like opening a map', async () => {
    const pins = [
      { id: 'a', lat: 38, lng: -107, title: 'A', color: 'red' },
      { id: 'b', lat: 39, lng: -106, title: 'B', color: 'blue' },
    ] as any;

    const { unmount } = render(
      <MapView
        key="portrait"
        pins={pins}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        show3DTerrain={true}
        bottomPadding={350}
        leftPadding={0}
      />
    );

    await waitFor(() => {
      expect(mockFitBounds.mock.calls.length + mockFlyTo.mock.calls.length).toBeGreaterThan(0);
    });

    unmount();
    mockFlyTo.mockClear();
    mockFitBounds.mockClear();
    capturedMapProps.current = null;

    render(
      <MapView
        key="landscape"
        pins={pins}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        show3DTerrain={true}
        bottomPadding={0}
        leftPadding={400}
      />
    );

    await waitFor(() => {
      expect(mockFitBounds.mock.calls.length + mockFlyTo.mock.calls.length).toBeGreaterThan(0);
    });
    expect(capturedMapProps.current.initialViewState).toEqual(expect.objectContaining({
      fitBoundsOptions: expect.objectContaining({
        padding: {
          top: 80,
          left: 480,
          right: 80,
          bottom: 80,
        },
      }),
    }));
  });


  it('preserves LngLat wrap method on transform.center and defends elevation sampling', () => {
    const trProto = {
      setCenter(this: any, c: any) {
        this.center = c;
      },
    };
    const tr: any = Object.create(trProto);
    tr.pitch = 0;
    tr.zoom = 12;
    tr.center = { lng: -105, lat: 39, wrap: vi.fn() };
    tr.recalculateZoomAndCenter = vi.fn();
    tr.setElevation = vi.fn();

    const cameraProto = {
      applyUpdatedTransform(this: any, _tr: any) {},
    };
    const camera: any = Object.create(cameraProto);
    camera.transform = tr;
    camera._finalizeElevation = vi.fn();

    const terrainProto = {
      getMinTileElevationForLngLatZoom(this: any, lnglat: any) {
        expect(typeof lnglat.wrap).toBe('function');
        return 100;
      },
    };
    const mockTerrain: any = Object.create(terrainProto);
    mockTerrain.tileManager = { maxzoom: 22 };
    mockTerrain.getElevationForLngLatZoom = vi.fn((lnglat: any) => 100);

    const mockMap = {
      setTerrain: vi.fn(),
      getTerrain: vi.fn(() => null),
      terrain: mockTerrain,
      _camera: camera,
      transform: tr,
      _handlers: { _changes: [] },
      triggerRepaint: vi.fn(),
    };

    syncOfflineTerrain(mockMap as any, true);

    // 1. Calling setCenter with a plain { lng, lat } converts to LngLat with wrap method
    tr.setCenter({ lng: -105.1, lat: 39.2 });
    expect(typeof tr.center.wrap).toBe('function');

    // 2. Calling terrain elevation methods with a plain { lng, lat } handles it safely
    const plainCoords = { lng: -105.2, lat: 39.3 };
    const minEle = mockMap.terrain.getMinTileElevationForLngLatZoom(plainCoords, 12);
    expect(minEle).toBe(100);

    // 3. applyUpdatedTransform idle branch does not downgrade center to plain object
    tr.center = { lng: -105.100000001, lat: 39.200000001, wrap: vi.fn() };
    camera.applyUpdatedTransform(tr);
    expect(typeof tr.center.wrap).toBe('function');
  });

  it('updates hillshade and 3D buildings visibility directly without waiting for idle', async () => {
    mockSetLayoutProperty.mockClear();

    const { rerender } = render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        showHillshade={true}
        show3DBuildings={true}
      />
    );

    act(() => {
      capturedMapProps.current.onLoad({ target: mockMapInstance.getMap() });
    });

    mockSetLayoutProperty.mockClear();

    rerender(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        showHillshade={false}
        show3DBuildings={false}
      />
    );

    await waitFor(() => {
      expect(mockSetLayoutProperty).toHaveBeenCalledWith('hills', 'visibility', 'none');
      expect(mockSetLayoutProperty).toHaveBeenCalledWith('3d-buildings', 'visibility', 'none');
      expect(mockSetLayoutProperty).toHaveBeenCalledWith('buildings', 'visibility', 'visible');
    });
  });
});

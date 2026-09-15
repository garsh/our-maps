import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MapView, { isPinInPaddedViewport, shouldSuspendOfflineTerrain } from '../MapView';
import { getHoveredPinId, setHoveredPin, resetPinHoverForTests } from '../../utils/pinHover';
import { getMapViewportBounds, resetMapViewportBoundsForTests } from '../../utils/mapViewport';

const { capturedMapProps } = vi.hoisted(() => ({
  capturedMapProps: { current: null as any },
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
const mockIsWebGLContextLost = vi.fn(() => false);
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockCanvasAddEventListener = vi.fn();
const mockCanvasRemoveEventListener = vi.fn();

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
      }
      // Trigger onLoad after render
      setTimeout(() => {
        onLoad?.({ target: mockMapInstance.getMap() });
      }, 0);
      return <div data-testid="react-map-gl-mock">{children}</div>;
    },
    Marker: ({ children }: any) => <div data-testid="marker-mock">{children}</div>,
    Source: ({ children }: any) => <div data-testid="source-mock">{children}</div>,
    Layer: () => null,
    AttributionControl: () => null,
  };
});

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: 'blob:http://localhost/maplibre-worker',
}));

vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(),
  addProtocol: vi.fn(),
}));

vi.mock('pmtiles', () => ({
  Protocol: class {
    tilev4 = vi.fn();
  },
}));

describe('shouldSuspendOfflineTerrain', () => {
  it('suspends 3D terrain only when offline and zoomed past 16', () => {
    expect(shouldSuspendOfflineTerrain(16, true)).toBe(false);
    expect(shouldSuspendOfflineTerrain(16.01, true)).toBe(true);
    expect(shouldSuspendOfflineTerrain(22, true)).toBe(true);
    expect(shouldSuspendOfflineTerrain(22, false)).toBe(false);
    expect(shouldSuspendOfflineTerrain(10, true)).toBe(false);
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

  it('slices vector tiles above source maxzoom instead of GPU-stretching z=15', () => {
    render(
      <MapView
        pins={[]}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
      />
    );

    expect(capturedMapProps.current.maxZoom).toBe(22);
    expect(capturedMapProps.current.zoomLevelsToOverscale).toBe(0);
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
});

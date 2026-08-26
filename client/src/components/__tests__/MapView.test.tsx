import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MapView from '../MapView';

// Mock react-map-gl/maplibre
const mockEaseTo = vi.fn();
const mockGetZoom = vi.fn(() => 10);
const mockGetBearing = vi.fn(() => 0);
const mockGetPitch = vi.fn(() => 0);
const mockGetBounds = vi.fn(() => ({
  getNorthWest: () => ({ lat: 40, lng: -70 }),
  getSouthEast: () => ({ lat: 30, lng: -80 }),
}));

const mockMapInstance = {
  getMap: () => ({
    getZoom: mockGetZoom,
    getBearing: mockGetBearing,
    getPitch: mockGetPitch,
    getBounds: mockGetBounds,
    easeTo: mockEaseTo,
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    setTerrain: vi.fn(),
    triggerRepaint: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    isMoving: vi.fn(() => false),
    once: vi.fn(),
  }),
  getZoom: mockGetZoom,
  getBearing: mockGetBearing,
  getPitch: mockGetPitch,
  getBounds: mockGetBounds,
  easeTo: mockEaseTo,
  flyTo: vi.fn(),
  fitBounds: vi.fn(),
};

vi.mock('react-map-gl/maplibre', () => {
  return {
    default: ({ children, onLoad, ref }: any) => {
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
    AttributionControl: () => null,
  };
});

vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(),
  addProtocol: vi.fn(),
}));

vi.mock('pmtiles', () => ({
  Protocol: class {
    tilev4 = vi.fn();
  },
}));

describe('MapView Compass and Tilt Indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('resets compass bearing and tilt when control button is clicked', () => {
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

    expect(mockEaseTo).toHaveBeenCalledWith({ pitch: 60, duration: 300 });
  });

  it('triggers onHoverPin with pin.id on mouse enter and (null, pin.id) on mouse leave', () => {
    const mockOnHoverPin = vi.fn();
    const mockPins = [
      { id: 'pin-1', lat: 10, lng: 20, label: 'Test Pin', color: 'blue' as const, position: 0 }
    ];

    const { container } = render(
      <MapView
        pins={mockPins}
        onMapClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onBoundsChange={vi.fn()}
        onHoverPin={mockOnHoverPin}
      />
    );

    const pinElement = container.querySelector('.leaflet-marker-icon');
    expect(pinElement).toBeInTheDocument();

    fireEvent.mouseEnter(pinElement!);
    expect(mockOnHoverPin).toHaveBeenCalledWith('pin-1');

    fireEvent.mouseLeave(pinElement!);
    expect(mockOnHoverPin).toHaveBeenCalledWith(null, 'pin-1');
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
    const mockWatchPosition = vi.fn().mockReturnValue(12345);
    const mockClearWatch = vi.fn();
    Object.defineProperty(global.navigator, 'geolocation', {
      value: {
        watchPosition: mockWatchPosition,
        clearWatch: mockClearWatch,
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

    const locatorButton = screen.getByRole('button', { name: /Find my location/i });
    expect(locatorButton).toHaveAttribute('aria-pressed', 'false');

    // Turn tracking ON
    fireEvent.click(locatorButton);

    expect(mockWatchPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Stop location tracking/i })).toHaveAttribute('aria-pressed', 'true');

    // Turn tracking OFF
    fireEvent.click(screen.getByRole('button', { name: /Stop location tracking/i }));

    expect(mockClearWatch).toHaveBeenCalledWith(12345);
    expect(screen.getByRole('button', { name: /Find my location/i })).toHaveAttribute('aria-pressed', 'false');
  });
});

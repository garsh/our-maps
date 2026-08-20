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
});

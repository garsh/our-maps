import { describe, it, expect } from 'vitest';
import { mapDataToGeoJSON, geoJSONToPins } from '../fileUtils';
import type { MapData } from '@shared/interfaces';

describe('fileUtils', () => {
  const mockMapData: MapData = {
    id: 'map-1',
    name: 'Test Map',
    ownerId: 'user-1',
    groups: [],
    pins: [
      {
        id: 'pin-1',
        lat: 10,
        lng: 20,
        label: 'Pin 1',
        description: 'Desc 1',
        color: 'red',
        icon: 'hotel',
        position: 0
      }
    ]
  };

  it('converts map data to GeoJSON correctly', () => {
    const geojson = mapDataToGeoJSON(mockMapData);
    
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(1);
    
    const feature = geojson.features[0];
    expect(feature.geometry.type).toBe('Point');
    expect(feature.geometry.coordinates).toEqual([20, 10]); // [lng, lat]
    expect(feature.properties.name).toBe('Pin 1');
    expect(feature.properties.icon).toBe('hotel');
  });

  it('converts GeoJSON back to pins correctly', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [30, 40] },
          properties: {
            name: 'Imported',
            description: 'Imported Desc',
            color: 'green'
          }
        }
      ]
    };

    const pins = geoJSONToPins(geojson);
    
    expect(pins).toHaveLength(1);
    expect(pins[0].lat).toBe(40);
    expect(pins[0].lng).toBe(30);
    expect(pins[0].label).toBe('Imported');
    expect(pins[0].color).toBe('green');
    expect(pins[0].id).toBeDefined();
  });

  it('defaults invalid pin styles to standard ones', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [30, 40] },
          properties: {
            name: 'Weird Style',
            color: 'invalid-color',
            icon: 'non-existent-icon'
          }
        }
      ]
    };

    const pins = geoJSONToPins(geojson);
    
    expect(pins[0].color).toBe('blue');
    expect(pins[0].icon).toBe('default');
  });

  it('handles empty or invalid geojson', () => {
    expect(geoJSONToPins(null)).toEqual([]);
    expect(geoJSONToPins({})).toEqual([]);
  });
});

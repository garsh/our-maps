import { describe, it, expect } from 'vitest';
import { mapDataToGeoJSON, geoJSONToData } from '../fileUtils';
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

    const { pins } = geoJSONToData(geojson);
    
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

    const { pins } = geoJSONToData(geojson);
    
    expect(pins[0].color).toBe('blue');
    expect(pins[0].icon).toBe('default');
  });

  it('handles empty or invalid geojson', () => {
    expect(geoJSONToData(null)).toEqual({ pins: [], groups: [] });
    expect(geoJSONToData({})).toEqual({ pins: [], groups: [] });
  });

  it('converts KML folders into groups', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 10] },
          properties: { name: 'Pin 1', folder: 'Layer 1' }
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [20, 20] },
          properties: { name: 'Pin 2', folder: 'Layer 1' }
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [30, 30] },
          properties: { name: 'Pin 3', folder: 'Layer 2' }
        }
      ]
    };

    const { pins, groups } = geoJSONToData(geojson);
    
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('Layer 1');
    expect(groups[1].name).toBe('Layer 2');
    
    expect(pins).toHaveLength(3);
    expect(pins[0].groupId).toBe(groups[0].id);
    expect(pins[1].groupId).toBe(groups[0].id);
    expect(pins[2].groupId).toBe(groups[1].id);
  });

  it('detects folders from various property names (folder, layer, parentName)', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 10] },
          properties: { name: 'P1', layer: 'Group A' }
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [20, 20] },
          properties: { name: 'P2', parentName: 'Group B' }
        }
      ]
    };

    const { pins, groups } = geoJSONToData(geojson);
    
    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.name === 'Group A')).toBeDefined();
    expect(groups.find(g => g.name === 'Group B')).toBeDefined();
    
    const pin1 = pins.find(p => p.label === 'P1');
    const groupA = groups.find(g => g.name === 'Group A');
    expect(pin1?.groupId).toBe(groupA?.id);
  });

  it('detects folders from nested meta properties (common in some KML exports)', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 10] },
          properties: { name: 'P1', meta: { layer: 'Nested Layer' } }
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [20, 20] },
          properties: { name: 'P2', folder: 'Direct Folder' }
        }
      ]
    };

    const { groups } = geoJSONToData(geojson);
    
    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.name === 'Nested Layer')).toBeDefined();
    expect(groups.find(g => g.name === 'Direct Folder')).toBeDefined();
  });

  it('correctly associates Placemarks with their parent Folder in standard KML', async () => {
    const kmlContent = `
      <?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <name>My Map</name>
          <Folder>
            <name>Shopping</name>
            <Placemark>
              <name>Costco</name>
              <Point>
                <coordinates>-77.0,38.9</coordinates>
              </Point>
            </Placemark>
          </Folder>
          <Placemark>
            <name>Orphan Pin</name>
            <Point><coordinates>0,0</coordinates></Point>
          </Placemark>
        </Document>
      </kml>
    `;

    // We need to test importMapFile directly since we are moving logic there
    const file = new File([kmlContent], 'test.kml', { type: 'application/vnd.google-earth.kml+xml' });
    const { importMapFile } = await import('../fileUtils');
    
    const result = await importMapFile(file);
    
    expect(result.groups).toHaveLength(1);
    expect(result.groups![0].name).toBe('Shopping');
    
    const costco = result.pins!.find(p => p.label === 'Costco');
    expect(costco).toBeDefined();
    expect(costco!.groupId).toBe(result.groups![0].id);
    
    const orphan = result.pins!.find(p => p.label === 'Orphan Pin');
    expect(orphan!.groupId).toBeUndefined();
  });

  it('remaps group and pin IDs when importing a JSON map file', async () => {
    const jsonContent = JSON.stringify({
      id: 'existing-map-id',
      name: 'Imported JSON Map',
      groups: [
        { id: 'old-group-1', name: 'Favorites', position: 0 }
      ],
      pins: [
        { id: 'old-pin-1', groupId: 'old-group-1', lat: 37.77, lng: -122.41, label: 'SF Landmark', position: 0 }
      ]
    });

    const file = new File([jsonContent], 'map.json', { type: 'application/json' });
    const { importMapFile } = await import('../fileUtils');

    const result = await importMapFile(file);

    expect(result.id).toBeUndefined();
    expect(result.name).toBe('Imported JSON Map');
    expect(result.groups).toHaveLength(1);
    expect(result.groups![0].id).not.toBe('old-group-1');
    expect(result.groups![0].name).toBe('Favorites');

    expect(result.pins).toHaveLength(1);
    expect(result.pins![0].id).not.toBe('old-pin-1');
    expect(result.pins![0].groupId).toBe(result.groups![0].id);
  });
});

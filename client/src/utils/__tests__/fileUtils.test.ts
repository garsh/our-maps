import { describe, it, expect } from 'vitest';
import { mapDataToGeoJSON, geoJSONToData, mergeImportedMapData } from '../fileUtils';
import type { MapData, Pin, PinLayer } from '@shared/interfaces';

describe('fileUtils', () => {
  const mockMapData: MapData = {
    id: 'map-1',
    name: 'Test Map',
    ownerId: 'user-1',
    layers: [],
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
    expect(geoJSONToData(null)).toEqual({ pins: [], layers: [] });
    expect(geoJSONToData({})).toEqual({ pins: [], layers: [] });
  });

  it('converts KML folders into layers', () => {
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

    const { pins, layers } = geoJSONToData(geojson);
    
    expect(layers).toHaveLength(2);
    expect(layers[0].name).toBe('Layer 1');
    expect(layers[1].name).toBe('Layer 2');
    
    expect(pins).toHaveLength(3);
    expect(pins[0].layerId).toBe(layers[0].id);
    expect(pins[1].layerId).toBe(layers[0].id);
    expect(pins[2].layerId).toBe(layers[1].id);
  });

  it('detects folders from various property names (folder, layer, parentName)', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 10] },
          properties: { name: 'P1', layer: 'Layer A' }
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [20, 20] },
          properties: { name: 'P2', parentName: 'Layer B' }
        }
      ]
    };

    const { pins, layers } = geoJSONToData(geojson);
    
    expect(layers).toHaveLength(2);
    expect(layers.find(g => g.name === 'Layer A')).toBeDefined();
    expect(layers.find(g => g.name === 'Layer B')).toBeDefined();
    
    const pin1 = pins.find(p => p.label === 'P1');
    const groupA = layers.find(g => g.name === 'Layer A');
    expect(pin1?.layerId).toBe(groupA?.id);
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

    const { layers } = geoJSONToData(geojson);
    
    expect(layers).toHaveLength(2);
    expect(layers.find(g => g.name === 'Nested Layer')).toBeDefined();
    expect(layers.find(g => g.name === 'Direct Folder')).toBeDefined();
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
    
    expect(result.layers).toHaveLength(1);
    expect(result.layers![0].name).toBe('Shopping');
    
    const costco = result.pins!.find(p => p.label === 'Costco');
    expect(costco).toBeDefined();
    expect(costco!.layerId).toBe(result.layers![0].id);
    
    const orphan = result.pins!.find(p => p.label === 'Orphan Pin');
    expect(orphan!.layerId).toBeUndefined();
  });

  it('remaps layer and pin IDs when importing a JSON map file', async () => {
    const jsonContent = JSON.stringify({
      id: 'existing-map-id',
      name: 'Imported JSON Map',
      layers: [
        { id: 'old-layer-1', name: 'Favorites', position: 0 }
      ],
      pins: [
        { id: 'old-pin-1', layerId: 'old-layer-1', lat: 37.77, lng: -122.41, label: 'SF Landmark', position: 0 }
      ]
    });

    const file = new File([jsonContent], 'map.json', { type: 'application/json' });
    const { importMapFile } = await import('../fileUtils');

    const result = await importMapFile(file);

    expect(result.id).toBeUndefined();
    expect(result.name).toBe('Imported JSON Map');
    expect(result.layers).toHaveLength(1);
    expect(result.layers![0].id).not.toBe('old-layer-1');
    expect(result.layers![0].name).toBe('Favorites');

    expect(result.pins).toHaveLength(1);
    expect(result.pins![0].id).not.toBe('old-pin-1');
    expect(result.pins![0].layerId).toBe(result.layers![0].id);
  });

  it('round-trips KML export through importMapFile, preserving folders and pins', async () => {
    const { mapDataToKml } = await import('../kmlUtils');
    const { importMapFile } = await import('../fileUtils');

    const mapData: MapData = {
      id: 'map-export',
      name: 'Exported Trails',
      ownerId: 'user-1',
      layers: [
        { id: 'layer-1', name: 'Lookouts', position: 0 }
      ],
      pins: [
        { id: 'pin-1', lat: 37.8, lng: -122.4, label: 'Vista', description: 'Best view', layerId: 'layer-1', position: 0 },
        { id: 'pin-2', lat: 37.7, lng: -122.5, label: 'Parking', position: 1 }
      ]
    };

    const file = new File([mapDataToKml(mapData)], 'export.kml', { type: 'application/vnd.google-earth.kml+xml' });
    const result = await importMapFile(file);

    expect(result.name).toBe('Exported Trails');
    expect(result.layers).toHaveLength(1);
    expect(result.layers![0].name).toBe('Lookouts');
    expect(result.pins).toHaveLength(2);

    const vista = result.pins!.find((pin) => pin.label === 'Vista');
    expect(vista).toBeDefined();
    expect(vista!.lat).toBe(37.8);
    expect(vista!.lng).toBe(-122.4);
    expect(vista!.description).toBe('Best view');
    expect(vista!.layerId).toBe(result.layers![0].id);

    const parking = result.pins!.find((pin) => pin.label === 'Parking');
    expect(parking).toBeDefined();
    expect(parking!.layerId).toBeUndefined();
  });

  describe('mergeImportedMapData', () => {
    const existingLayers: PinLayer[] = [
      { id: 'layer-a', name: 'Existing', position: 0 }
    ];
    const existingPins: Pin[] = [
      { id: 'pin-a', lat: 1, lng: 2, label: 'Already here', position: 0, layerId: 'layer-a' },
      { id: 'pin-b', lat: 3, lng: 4, label: 'Default pin', position: 0 }
    ];

    it('appends imported pins and layers without replacing existing ones', () => {
      const merged = mergeImportedMapData(existingLayers, existingPins, {
        layers: [{ id: 'old-layer', name: 'Imported Layer', position: 0 }],
        pins: [
          { id: 'old-pin-1', lat: 10, lng: 20, label: 'Cafe', position: 0, layerId: 'old-layer' },
          { id: 'old-pin-2', lat: 11, lng: 21, label: 'Park', position: 0 }
        ]
      });

      expect(merged.layers).toHaveLength(2);
      expect(merged.layers[0].id).toBe('layer-a');
      expect(merged.addedLayers).toHaveLength(1);
      expect(merged.addedLayers[0].id).not.toBe('old-layer');
      expect(merged.addedLayers[0].name).toBe('Imported Layer');
      expect(merged.addedLayers[0].position).toBe(1);

      expect(merged.pins).toHaveLength(4);
      expect(merged.pins[0].id).toBe('pin-a');
      expect(merged.addedPins).toHaveLength(2);
      expect(merged.addedPins[0].id).not.toBe('old-pin-1');
      expect(merged.addedPins[0].layerId).toBe(merged.addedLayers[0].id);
      expect(merged.addedPins[0].position).toBe(0);
      expect(merged.addedPins[1].layerId).toBeUndefined();
      expect(merged.addedPins[1].position).toBe(1);
    });

    it('skips pins and layers that would exceed map size limits', () => {
      const merged = mergeImportedMapData(
        existingLayers,
        existingPins,
        {
          layers: [
            { id: 'l1', name: 'One', position: 0 },
            { id: 'l2', name: 'Two', position: 1 }
          ],
          pins: [
            { id: 'p1', lat: 1, lng: 1, label: 'Keep', position: 0, layerId: 'l1' },
            { id: 'p2', lat: 2, lng: 2, label: 'Skip layer pin', position: 0, layerId: 'l2' },
            { id: 'p3', lat: 3, lng: 3, label: 'Skip pin cap', position: 0 }
          ]
        },
        { maxLayers: 2, maxPins: 3 }
      );

      expect(merged.addedLayers).toHaveLength(1);
      expect(merged.skippedLayers).toBe(1);
      expect(merged.addedPins).toHaveLength(1);
      expect(merged.addedPins[0].label).toBe('Keep');
      expect(merged.skippedPins).toBe(2);
      expect(merged.pins).toHaveLength(3);
    });

    it('does not merge layers with the same name', () => {
      const existingLayers: PinLayer[] = [
        { id: 'existing-trails', name: 'Trails', position: 0 }
      ];
      const existingPins: Pin[] = [
        { id: 'pin-1', lat: 10, lng: 20, label: 'Trailhead A', position: 0, layerId: 'existing-trails' }
      ];
      const merged = mergeImportedMapData(existingLayers, existingPins, {
        layers: [{ id: 'imported-trails', name: 'Trails', position: 0 }],
        pins: [{ id: 'pin-2', lat: 11, lng: 21, label: 'Trailhead B', position: 0, layerId: 'imported-trails' }]
      });

      expect(merged.layers).toHaveLength(2);
      expect(merged.layers[0].id).toBe('existing-trails');
      expect(merged.layers[0].name).toBe('Trails');
      expect(merged.layers[1].id).not.toBe('existing-trails');
      expect(merged.layers[1].name).toBe('Trails');
      expect(merged.pins).toHaveLength(2);
      expect(merged.pins[0].layerId).toBe('existing-trails');
      expect(merged.pins[1].layerId).toBe(merged.layers[1].id);
    });

    it('appends pins in the default layer to the existing default layer', () => {
      const existingPins: Pin[] = [
        { id: 'pin-d1', lat: 1, lng: 1, label: 'Default 1', position: 0 },
        { id: 'pin-d2', lat: 2, lng: 2, label: 'Default 2', position: 4 }
      ];
      const merged = mergeImportedMapData([], existingPins, {
        pins: [
          { id: 'pin-imp-d1', lat: 3, lng: 3, label: 'Imported Default 1', position: 0 },
          { id: 'pin-imp-d2', lat: 4, lng: 4, label: 'Imported Default 2', position: 1 }
        ]
      });

      expect(merged.pins).toHaveLength(4);
      expect(merged.addedPins[0].position).toBe(5);
      expect(merged.addedPins[1].position).toBe(6);
    });

    it('imports pins and layers into an existing map with pins and layers', () => {
      const existingLayers: PinLayer[] = [
        { id: 'l-exist-1', name: 'Restaurants', position: 0 },
        { id: 'l-exist-2', name: 'Parks', position: 1 },
      ];
      const existingPins: Pin[] = [
        { id: 'p-exist-1', lat: 10, lng: 10, label: 'Diner', position: 0, layerId: 'l-exist-1' },
        { id: 'p-exist-2', lat: 20, lng: 20, label: 'Central Park', position: 0, layerId: 'l-exist-2' },
        { id: 'p-exist-3', lat: 30, lng: 30, label: 'Home', position: 2 },
      ];

      const importedMap: Partial<MapData> = {
        name: 'Should Be Ignored',
        layers: [
          { id: 'imp-l-1', name: 'Restaurants', position: 0 },
          { id: 'imp-l-2', name: 'Museums', position: 1 },
        ],
        pins: [
          { id: 'imp-p-1', lat: 11, lng: 11, label: 'Bistro', position: 0, layerId: 'imp-l-1' },
          { id: 'imp-p-2', lat: 22, lng: 22, label: 'Art Gallery', position: 0, layerId: 'imp-l-2' },
          { id: 'imp-p-3', lat: 33, lng: 33, label: 'Library', position: 0 },
        ]
      };

      const result = mergeImportedMapData(existingLayers, existingPins, importedMap);

      expect(result.layers).toHaveLength(4);
      expect(result.layers[0]).toEqual(existingLayers[0]);
      expect(result.layers[1]).toEqual(existingLayers[1]);
      expect(result.addedLayers).toHaveLength(2);

      expect(result.addedLayers[0].name).toBe('Restaurants');
      expect(result.addedLayers[0].id).not.toBe('l-exist-1');
      expect(result.addedLayers[0].position).toBe(2);

      expect(result.addedLayers[1].name).toBe('Museums');
      expect(result.addedLayers[1].position).toBe(3);

      expect(result.pins).toHaveLength(6);
      expect(result.pins.slice(0, 3)).toEqual(existingPins);
      expect(result.addedPins).toHaveLength(3);

      expect(result.addedPins[0].label).toBe('Bistro');
      expect(result.addedPins[0].layerId).toBe(result.addedLayers[0].id);

      expect(result.addedPins[1].label).toBe('Art Gallery');
      expect(result.addedPins[1].layerId).toBe(result.addedLayers[1].id);

      expect(result.addedPins[2].label).toBe('Library');
      expect(result.addedPins[2].layerId).toBeUndefined();
      expect(result.addedPins[2].position).toBe(3);
    });
  });
});

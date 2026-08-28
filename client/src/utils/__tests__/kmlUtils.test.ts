import { describe, it, expect } from 'vitest';
import { mapDataToKml, parseKmlHierarchy } from '../kmlUtils';
import { JSDOM } from 'jsdom';
import type { MapData } from '@shared/interfaces';

describe('parseKmlHierarchy Reproduction', () => {
  it('should correctly handle nested folders without duplicating pins', () => {
    const kmlContent = `
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <Folder>
            <name>Outer Folder</name>
            <Placemark>
              <name>Outer Pin</name>
              <Point><coordinates>0,0</coordinates></Point>
            </Placemark>
            <Folder>
              <name>Inner Folder</name>
              <Placemark>
                <name>Inner Pin</name>
                <Point><coordinates>1,1</coordinates></Point>
              </Placemark>
            </Folder>
          </Folder>
        </Document>
      </kml>
    `;

    const dom = new JSDOM(kmlContent, { contentType: 'text/xml' });
    const document = dom.window.document;

    const { pins, layers } = parseKmlHierarchy(document);

    // Expected:
    // 2 Groups: "Outer Folder", "Inner Folder"
    // 2 Pins: "Outer Pin" (in Outer Folder), "Inner Pin" (in Inner Folder)

    // Check for duplicates
    const innerPinCount = pins.filter(p => p.label === 'Inner Pin').length;
    expect(innerPinCount).toBe(1); // Fails if 2

    // Check layer assignment
    const outerPin = pins.find(p => p.label === 'Outer Pin');
    const innerPin = pins.find(p => p.label === 'Inner Pin');

    expect(outerPin).toBeDefined();
    expect(innerPin).toBeDefined();

    const outerLayer = layers.find(g => g.name === 'Outer Folder');
    const innerLayer = layers.find(g => g.name === 'Inner Folder');

    expect(outerPin?.layerId).toBe(outerLayer?.id);
    expect(innerPin?.layerId).toBe(innerLayer?.id);
  });
});

describe('mapDataToKml', () => {
  const mapWithLayers: MapData = {
    id: 'map-1',
    name: 'Trail Map',
    ownerId: 'user-1',
    layers: [
      { id: 'layer-b', name: 'Camps', position: 1 },
      { id: 'layer-a', name: 'Trails', position: 0 }
    ],
    pins: [
      { id: 'pin-2', lat: 2, lng: 3, label: 'Camp', description: 'Night stop', layerId: 'layer-b', position: 0, color: 'red', icon: 'hotel' },
      { id: 'pin-1', lat: 10.5, lng: -20.25, label: 'Trailhead', description: 'Start here', layerId: 'layer-a', position: 0, color: 'blue', icon: 'default' },
      { id: 'pin-3', lat: 0, lng: 1, label: 'Ungrouped', position: 1 }
    ]
  };

  it('writes a KML document named after the map', () => {
    const kml = mapDataToKml(mapWithLayers);
    expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml).toMatch(/<Document>\s*<name>Trail Map<\/name>/);
  });

  it('emits layers as Folders in position order and ungrouped pins at document level', () => {
    const kml = mapDataToKml(mapWithLayers);
    const trailsIdx = kml.indexOf('<name>Trails</name>');
    const campsIdx = kml.indexOf('<name>Camps</name>');
    const ungroupedIdx = kml.indexOf('<name>Ungrouped</name>');
    expect(trailsIdx).toBeGreaterThan(-1);
    expect(campsIdx).toBeGreaterThan(trailsIdx);
    expect(ungroupedIdx).toBeGreaterThan(campsIdx);

    const trailsFolder = kml.slice(trailsIdx, campsIdx);
    expect(trailsFolder).toContain('<name>Trailhead</name>');
    expect(trailsFolder).not.toContain('<name>Camp</name>');
  });

  it('writes Point coordinates as lng,lat', () => {
    const kml = mapDataToKml(mapWithLayers);
    expect(kml).toContain('<coordinates>-20.25,10.5</coordinates>');
    expect(kml).toContain('<coordinates>3,2</coordinates>');
  });

  it('includes pin descriptions and omits empty ones', () => {
    const kml = mapDataToKml(mapWithLayers);
    expect(kml).toContain('<description>Start here</description>');
    expect(kml).toContain('<description>Night stop</description>');
    const ungroupedBlock = kml.slice(kml.indexOf('<name>Ungrouped</name>'));
    expect(ungroupedBlock).not.toContain('<description>');
  });

  it('escapes XML special characters in names and descriptions', () => {
    const kml = mapDataToKml({
      id: 'map-2',
      name: 'A & B <Map>',
      ownerId: 'user-1',
      layers: [{ id: 'layer-1', name: `Tom's "Layer"`, position: 0 }],
      pins: [
        {
          id: 'pin-1',
          lat: 1,
          lng: 2,
          label: 'Cafe & Bar',
          description: 'Try the <soup> & "fries"',
          layerId: 'layer-1',
          position: 0
        }
      ]
    });

    expect(kml).toContain('<name>A &amp; B &lt;Map&gt;</name>');
    expect(kml).toContain(`<name>Tom&apos;s &quot;Layer&quot;</name>`);
    expect(kml).toContain('<name>Cafe &amp; Bar</name>');
    expect(kml).toContain('<description>Try the &lt;soup&gt; &amp; &quot;fries&quot;</description>');
    expect(kml).not.toContain('<name>A & B <Map></name>');
  });

  it('still emits empty layers as Folders', () => {
    const kml = mapDataToKml({
      id: 'map-3',
      name: 'Empty Layer Map',
      ownerId: 'user-1',
      layers: [{ id: 'layer-empty', name: 'Reserved', position: 0 }],
      pins: []
    });
    expect(kml).toContain('<Folder>');
    expect(kml).toContain('<name>Reserved</name>');
  });

  it('round-trips through parseKmlHierarchy', () => {
    const kml = mapDataToKml(mapWithLayers);
    const document = new JSDOM(kml, { contentType: 'text/xml' }).window.document;
    const { pins, layers } = parseKmlHierarchy(document);

    expect(layers.map((layer) => layer.name)).toEqual(['Trails', 'Camps']);
    expect(pins.map((pin) => pin.label)).toEqual(['Trailhead', 'Camp', 'Ungrouped']);

    const trailhead = pins.find((pin) => pin.label === 'Trailhead')!;
    expect(trailhead.lat).toBe(10.5);
    expect(trailhead.lng).toBe(-20.25);
    expect(trailhead.description).toBe('Start here');
    expect(trailhead.layerId).toBe(layers.find((layer) => layer.name === 'Trails')?.id);

    const ungrouped = pins.find((pin) => pin.label === 'Ungrouped')!;
    expect(ungrouped.layerId).toBeUndefined();
    expect(ungrouped.description).toBe('');
  });
});

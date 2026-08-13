import { describe, it, expect } from 'vitest';
import { parseKmlHierarchy } from '../kmlUtils';
import { JSDOM } from 'jsdom';

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

    console.log('Groups:', layers.map(g => g.name));
    console.log('Pins:', pins.map(p => `${p.label} (Layer: ${layers.find(g => g.id === p.layerId)?.name})`));

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

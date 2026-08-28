import type { MapData, Pin, PinLayer } from '@shared/interfaces';
import { generateId } from './fileUtils';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pinPlacemarkXml(pin: Pin): string {
  const description = pin.description
    ? `\n        <description>${escapeXml(pin.description)}</description>`
    : '';
  return `      <Placemark>
        <name>${escapeXml(pin.label)}</name>${description}
        <Point>
          <coordinates>${pin.lng},${pin.lat}</coordinates>
        </Point>
      </Placemark>`;
}

/**
 * Serializes map pins and layers to KML 2.2.
 * Layers become Folders so parseKmlHierarchy can round-trip them.
 */
export function mapDataToKml(mapData: MapData): string {
  const sortedLayers = [...mapData.layers].sort((a, b) => a.position - b.position);
  const knownLayerIds = new Set(sortedLayers.map((layer) => layer.id));

  const foldersXml = sortedLayers.map((layer) => {
    const layerPins = mapData.pins
      .filter((pin) => pin.layerId === layer.id)
      .sort((a, b) => a.position - b.position)
      .map(pinPlacemarkXml)
      .join('\n');
    return `    <Folder>
      <name>${escapeXml(layer.name)}</name>
${layerPins}
    </Folder>`;
  }).join('\n');

  const ungroupedXml = mapData.pins
    .filter((pin) => !pin.layerId || !knownLayerIds.has(pin.layerId))
    .sort((a, b) => a.position - b.position)
    .map(pinPlacemarkXml)
    .join('\n');

  const body = [foldersXml, ungroupedXml].filter(Boolean).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(mapData.name || 'Untitled Map')}</name>
${body}
  </Document>
</kml>
`;
}

/**
 * Manually parses KML DOM to extract Folders and Placemarks, preserving hierarchy.
 */
export const parseKmlHierarchy = (kmlDoc: Document): { pins: Pin[], layers: PinLayer[] } => {
  const pins: Pin[] = [];
  const layers: PinLayer[] = [];
  const layerMap = new Map<string, string>(); // name -> id


  const getOrCreateLayerId = (folderName: string): string => {
    if (layerMap.has(folderName)) {
      return layerMap.get(folderName)!;
    }
    const newId = generateId();
    layerMap.set(folderName, newId);
    layers.push({
      id: newId,
      name: folderName,
      position: layers.length
    });
    return newId;
  };

  // Helper to parse a Placemark element
  const parsePlacemark = (placemark: Element, layerId?: string) => {
    const name = placemark.querySelector('name')?.textContent || 'Imported Pin';
    const description = placemark.querySelector('description')?.textContent || '';
    
    // Extract coordinates
    const point = placemark.querySelector('Point');
    if (!point) return; // Only interested in Points for now
    
    const coordinates = point.querySelector('coordinates')?.textContent?.trim();
    if (!coordinates) return;

    const [lngStr, latStr] = coordinates.split(',');
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    if (isNaN(lat) || isNaN(lng)) return;

    // Extract styles (basic logic)
    // Real parsing of styles is complex in KML, we default to blue for now
    // unless description/name suggests otherwise or we enhance this later.
    
    pins.push({
      id: generateId(),
      lat,
      lng,
      label: name,
      description,
      color: 'blue',
      icon: 'default',
      layerId,
      position: pins.length
    });
  };

  // Recursive traversal to handle nested Folders correctly
  const traverse = (element: Element, currentLayerId?: string) => {
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      const tagName = child.tagName;

      if (tagName === 'Folder') {
        // Extract folder name from direct child
        let folderName = 'Untitled Layer';
        const nameNode = Array.from(child.children).find(c => c.tagName === 'name');
        if (nameNode && nameNode.textContent) {
          folderName = nameNode.textContent;
        }

        const layerId = getOrCreateLayerId(folderName);
        traverse(child, layerId);
      } else if (tagName === 'Placemark') {
        parsePlacemark(child, currentLayerId);
      } else if (tagName === 'Document' || tagName === 'kml') {
        traverse(child, currentLayerId);
      }
    }
  };

  // Start traversal from root
  if (kmlDoc.firstElementChild) {
    traverse(kmlDoc.firstElementChild);
  }

  return { pins, layers };
};

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
  const layerOrder = new Map<string, { name: string; order: number }>();
  sortedLayers.forEach((layer, idx) => {
    layerOrder.set(layer.id, { name: layer.name, order: idx });
  });

  const sortedPins = [...mapData.pins].sort((a, b) => {
    const orderA = a.layerId !== undefined && layerOrder.has(a.layerId)
      ? layerOrder.get(a.layerId)!.order
      : Number.MAX_SAFE_INTEGER;
    const orderB = b.layerId !== undefined && layerOrder.has(b.layerId)
      ? layerOrder.get(b.layerId)!.order
      : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return (a.position ?? 0) - (b.position ?? 0);
  });

  const chunks: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n',
    `    <name>${escapeXml(mapData.name || 'Untitled Map')}</name>\n`
  ];

  const processedLayers = new Set<string>();
  let currentLayerId: string | null = null;
  let inFolder = false;

  for (const pin of sortedPins) {
    const pinKnownLayerId = pin.layerId && layerOrder.has(pin.layerId) ? pin.layerId : null;

    if (pinKnownLayerId !== currentLayerId) {
      if (inFolder) {
        chunks.push('    </Folder>\n');
        inFolder = false;
      }

      // Emit any empty layers in sorted order before this layer
      const targetOrder = pinKnownLayerId !== null
        ? layerOrder.get(pinKnownLayerId)!.order
        : sortedLayers.length;

      for (let i = 0; i < targetOrder; i++) {
        const l = sortedLayers[i];
        if (!processedLayers.has(l.id)) {
          chunks.push(`    <Folder>\n      <name>${escapeXml(l.name)}</name>\n    </Folder>\n`);
          processedLayers.add(l.id);
        }
      }

      if (pinKnownLayerId !== null) {
        const lInfo = layerOrder.get(pinKnownLayerId)!;
        chunks.push(`    <Folder>\n      <name>${escapeXml(lInfo.name)}</name>\n`);
        inFolder = true;
        processedLayers.add(pinKnownLayerId);
      }

      currentLayerId = pinKnownLayerId;
    }

    chunks.push(pinPlacemarkXml(pin) + '\n');
  }

  if (inFolder) {
    chunks.push('    </Folder>\n');
  }

  // Emit any remaining empty layers that had no pins
  for (const l of sortedLayers) {
    if (!processedLayers.has(l.id)) {
      chunks.push(`    <Folder>\n      <name>${escapeXml(l.name)}</name>\n    </Folder>\n`);
      processedLayers.add(l.id);
    }
  }

  chunks.push('  </Document>\n</kml>\n');
  return chunks.join('');
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

  // Helper to parse a Placemark element using fast direct child iteration
  const parsePlacemark = (placemark: Element, layerId?: string) => {
    let name = 'Imported Pin';
    let description = '';
    let coordinates: string | undefined;

    for (let i = 0; i < placemark.children.length; i++) {
      const child = placemark.children[i];
      const tag = child.tagName;
      if (tag === 'name') {
        name = child.textContent?.trim() || 'Imported Pin';
      } else if (tag === 'description') {
        description = child.textContent || '';
      } else if (tag === 'Point') {
        for (let j = 0; j < child.children.length; j++) {
          if (child.children[j].tagName === 'coordinates') {
            coordinates = child.children[j].textContent?.trim();
            break;
          }
        }
      }
    }

    if (!coordinates) return;

    const [lngStr, latStr] = coordinates.split(',');
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    if (isNaN(lat) || isNaN(lng)) return;

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
        for (let j = 0; j < child.children.length; j++) {
          if (child.children[j].tagName === 'name') {
            folderName = child.children[j].textContent?.trim() || 'Untitled Layer';
            break;
          }
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

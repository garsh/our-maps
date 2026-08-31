import type { MapData, Pin, PinLayer, PinIcon } from '@shared/interfaces';
import { mapDataToKml, parseKmlHierarchy } from './kmlUtils';

/**
 * Converts MapData to a GeoJSON FeatureCollection
 */
export const mapDataToGeoJSON = (mapData: MapData) => {
  const features = mapData.pins.map(pin => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [pin.lng, pin.lat]
    },
    properties: {
      id: pin.id,
      name: pin.label,
      description: pin.description,
      color: pin.color,
      icon: pin.icon,
      layerId: pin.layerId,
      position: pin.position
    }
  }));

  return {
    type: 'FeatureCollection',
    features
  };
};

/**
 * Generates a unique ID with a fallback for non-secure contexts.
 */
export const generateId = (): string => {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
};

/**
 * Parses GeoJSON FeatureCollection into Pins and Groups.
 * Extracts layer info from 'folder' / 'layer' / 'parentName' properties.
 */
export const geoJSONToData = (geojson: any): { pins: Pin[], layers: PinLayer[] } => {
  if (!geojson || geojson.type !== 'FeatureCollection') return { pins: [], layers: [] };

  const pins: Pin[] = [];
  const layers: PinLayer[] = [];
  const layerMap = new Map<string, string>(); // name -> id

  geojson.features
    .filter((f: any) => f.geometry && f.geometry.type === 'Point')
    .forEach((f: any, index: number) => {
      const [lng, lat] = f.geometry.coordinates;
      const props = f.properties || {};
      
      // Handle Groups (KML folders / layers)
      let layerId = props.layerId;
      
      // Helper to find folder name deeply
      const findFolderName = (obj: any): string | undefined => {
        if (!obj || typeof obj !== 'object') return undefined;
        
        // Direct checks
        if (obj.folder) return obj.folder;
        if (obj.layer) return obj.layer;
        if (obj.parentName) return obj.parentName;
        
        // Check nested 'meta' or similar common property containers
        if (obj.meta) {
          const nested = findFolderName(obj.meta);
          if (nested) return nested;
        }
        
        return undefined;
      };

      const folderName = findFolderName(props);
      
      if (!layerId && folderName) {
        if (layerMap.has(folderName)) {
          layerId = layerMap.get(folderName);
        } else {
          layerId = generateId();
          layerMap.set(folderName, layerId);
          layers.push({
            id: layerId,
            name: folderName,
            position: layers.length
          });
        }
      }

      const validIcons: PinIcon[] = ['default', 'hotel', 'restaurant', 'airport', 'car', 'bus', 'boat', 'train', 'gas', 'charging', 'shopping'];

      // Lenient color validation to support hex codes
      const color = (props.color && (props.color.startsWith('#') || ['blue', 'red', 'green', 'orange', 'violet'].includes(props.color))) 
        ? props.color 
        : 'blue';
      const icon = validIcons.includes(props.icon) ? props.icon : 'default';

      pins.push({
        id: props.id || generateId(),
        lat,
        lng,
        label: props.name || props.label || 'Imported Pin',
        description: props.description || '',
        color,
        icon,
        layerId,
        position: props.position ?? index
      });
    });

  return { pins, layers };
};

/**
 * Extracts map name from KML document
 */
const extractMapNameFromKML = (doc: Document): string | undefined => {
  const nameNode = doc.querySelector('Document > name') || doc.querySelector('Folder > name') || doc.querySelector('name');
  return nameNode?.textContent?.trim() || undefined;
};

/**
 * Downloads a string as a file
 */
export const downloadFile = (content: string, fileName: string, contentType: string) => {
  const a = document.createElement('a');
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
};

/**
 * Exports map data to various formats
 */
export const exportMap = (mapData: MapData, format: 'json' | 'geojson' | 'kml', customFileName?: string) => {
  const fileName = customFileName || `${mapData.name.replace(/\s+/g, '_')}_export`;

  switch (format) {
    case 'json': {
      downloadFile(JSON.stringify(mapData, null, 2), `${fileName}.json`, 'application/json');
      break;
    }
    case 'geojson': {
      const geojson = mapDataToGeoJSON(mapData);
      downloadFile(JSON.stringify(geojson, null, 2), `${fileName}.geojson`, 'application/geo+json');
      break;
    }
    case 'kml': {
      downloadFile(mapDataToKml(mapData), `${fileName}.kml`, 'application/vnd.google-earth.kml+xml');
      break;
    }
  }
};

/**
 * Imports map data from a file string
 */
export const importMapFile = async (file: File): Promise<Partial<MapData>> => {
  const content = (await file.text()).trim();
  const extension = file.name.split('.').pop()?.toLowerCase();

  try {
    if (extension === 'json') {
      const data = JSON.parse(content);
      if (Array.isArray(data.pins)) {
        const layerIdMap = new Map<string, string>();
        const layers: PinLayer[] = Array.isArray(data.layers)
          ? data.layers.map((g: PinLayer) => {
              const newId = generateId();
              if (g.id) {
                layerIdMap.set(g.id, newId);
              }
              return {
                ...g,
                id: newId
              };
            })
          : [];

        const pins: Pin[] = data.pins.map((p: Pin) => ({
          ...p,
          id: generateId(),
          layerId: p.layerId ? (layerIdMap.get(p.layerId) || p.layerId) : undefined
        }));

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _ignoreId, ...rest } = data;
        return {
          ...rest,
          layers,
          pins
        };
      }
    } else if (extension === 'geojson' || extension === 'kml') {
      let pins: Pin[] = [];
      let layers: PinLayer[] = [];
      let name: string | undefined;

      if (extension === 'geojson') {
        const geojson = JSON.parse(content);
        const data = geoJSONToData(geojson);
        pins = data.pins;
        layers = data.layers;
      } else {
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(content, 'text/xml');
        const errorNode = kmlDoc.querySelector('parsererror');
        if (errorNode) throw new Error('KML file has invalid XML structure');
        
        name = extractMapNameFromKML(kmlDoc);
        const result = parseKmlHierarchy(kmlDoc);
        pins = result.pins;
        layers = result.layers;
      }
      
      return { name, pins, layers };
    }
  } catch (error) {
    console.error('Failed to parse import file:', error);
    throw new Error(error instanceof Error ? error.message : 'Invalid file format or corrupted data');
  }

  throw new Error('Unsupported file extension');
};

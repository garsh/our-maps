import tokml from 'tokml';
import type { MapData, Pin, PinGroup, PinIcon } from '@shared/interfaces';
import { parseKmlHierarchy } from './kmlUtils';

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
      imageUrl: pin.imageUrl,
      color: pin.color,
      icon: pin.icon,
      groupId: pin.groupId,
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
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Parses GeoJSON FeatureCollection into Pins and Groups.
 * Extracts group info from 'folder' property (used by togeojson for KML layers).
 */
export const geoJSONToData = (geojson: any): { pins: Pin[], groups: PinGroup[] } => {
  if (!geojson || geojson.type !== 'FeatureCollection') return { pins: [], groups: [] };

  const pins: Pin[] = [];
  const groups: PinGroup[] = [];
  const groupMap = new Map<string, string>(); // name -> id

  geojson.features
    .filter((f: any) => f.geometry && f.geometry.type === 'Point')
    .forEach((f: any, index: number) => {
      const [lng, lat] = f.geometry.coordinates;
      const props = f.properties || {};
      
      // Handle Groups (KML folders / layers)
      let groupId = props.groupId;
      
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
      
      if (!groupId && folderName) {
        if (groupMap.has(folderName)) {
          groupId = groupMap.get(folderName);
        } else {
          groupId = generateId();
          groupMap.set(folderName, groupId);
          groups.push({
            id: groupId,
            name: folderName,
            position: groups.length
          });
        }
      }

      const validIcons: PinIcon[] = ['default', 'hotel', 'restaurant', 'airport', 'park', 'museum', 'shopping', 'camera'];

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
        imageUrl: props.imageUrl || '',
        color,
        icon,
        groupId,
        position: props.position ?? index
      });
    });

  return { pins, groups };
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
export const exportMap = (mapData: MapData, format: 'json' | 'geojson' | 'kml') => {
  const fileName = `${mapData.name.replace(/\s+/g, '_')}_export`;

  switch (format) {
    case 'json':
      downloadFile(JSON.stringify(mapData, null, 2), `${fileName}.json`, 'application/json');
      break;
    case 'geojson':
      const geojson = mapDataToGeoJSON(mapData);
      downloadFile(JSON.stringify(geojson, null, 2), `${fileName}.geojson`, 'application/geo+json');
      break;
    case 'kml':
      const kmlStr = tokml(mapDataToGeoJSON(mapData));
      downloadFile(kmlStr, `${fileName}.kml`, 'application/vnd.google-earth.kml+xml');
      break;
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
        const groupIdMap = new Map<string, string>();
        const groups: PinGroup[] = Array.isArray(data.groups)
          ? data.groups.map((g: PinGroup) => {
              const newId = generateId();
              if (g.id) {
                groupIdMap.set(g.id, newId);
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
          groupId: p.groupId ? (groupIdMap.get(p.groupId) || p.groupId) : undefined
        }));

        const { id: _ignoreId, ...rest } = data;
        return {
          ...rest,
          groups,
          pins
        };
      }
    } else if (extension === 'geojson' || extension === 'kml') {
      let pins: Pin[] = [];
      let groups: PinGroup[] = [];
      let name: string | undefined;

      if (extension === 'geojson') {
        const geojson = JSON.parse(content);
        const data = geoJSONToData(geojson);
        pins = data.pins;
        groups = data.groups;
      } else {
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(content, 'text/xml');
        const errorNode = kmlDoc.querySelector('parsererror');
        if (errorNode) throw new Error('KML file has invalid XML structure');
        
        name = extractMapNameFromKML(kmlDoc);
        const result = parseKmlHierarchy(kmlDoc);
        pins = result.pins;
        groups = result.groups;
      }
      
      return { name, pins, groups };
    }
  } catch (error) {
    console.error('Failed to parse import file:', error);
    throw new Error(error instanceof Error ? error.message : 'Invalid file format or corrupted data');
  }

  throw new Error('Unsupported file extension');
};

import tokml from 'tokml';
import { kml } from '@tmcw/togeojson';
import type { MapData, Pin, PinColor, PinIcon } from '@shared/interfaces';

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
 * Parses GeoJSON FeatureCollection into Pins.
 * Ensures that imported pins default to standard blue 'default' icon
 * unless they have specific properties matching our known types.
 */
export const geoJSONToPins = (geojson: any): Pin[] => {
  if (!geojson || geojson.type !== 'FeatureCollection') return [];

  return geojson.features
    .filter((f: any) => f.geometry && f.geometry.type === 'Point')
    .map((f: any, index: number) => {
      const [lng, lat] = f.geometry.coordinates;
      const props = f.properties || {};
      
      // Strict validation for colors and icons to avoid weird looking pins from external sources
      const validColors: PinColor[] = ['blue', 'red', 'green', 'orange', 'violet'];
      const validIcons: PinIcon[] = ['default', 'hotel', 'restaurant', 'airport', 'park', 'museum', 'shopping', 'camera'];

      const color = validColors.includes(props.color) ? props.color : 'blue';
      const icon = validIcons.includes(props.icon) ? props.icon : 'default';

      return {
        id: props.id || crypto.randomUUID(),
        lat,
        lng,
        label: props.name || props.label || 'Imported Pin',
        description: props.description || '',
        imageUrl: props.imageUrl || '',
        color,
        icon,
        groupId: props.groupId,
        position: props.position ?? index
      };
    });
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
  const content = await file.text();
  const extension = file.name.split('.').pop()?.toLowerCase();

  try {
    if (extension === 'json') {
      const data = JSON.parse(content);
      if (Array.isArray(data.pins)) {
        return data;
      }
    } else if (extension === 'geojson') {
      const data = JSON.parse(content);
      const pins = geoJSONToPins(data);
      return { pins, groups: [] };
    } else if (extension === 'kml') {
      const parser = new DOMParser();
      const kmlDoc = parser.parseFromString(content, 'text/xml');
      const name = extractMapNameFromKML(kmlDoc);
      const geojson = kml(kmlDoc);
      const pins = geoJSONToPins(geojson);
      return { name, pins, groups: [] };
    }
  } catch (error) {
    console.error('Failed to parse import file:', error);
    throw new Error('Invalid file format or corrupted data');
  }

  throw new Error('Unsupported file extension');
};

import type { Pin, PinGroup } from '@shared/interfaces';

/**
 * Manually parses KML DOM to extract Folders and Placemarks, preserving hierarchy.
 */
export const parseKmlHierarchy = (kmlDoc: Document): { pins: Pin[], groups: PinGroup[] } => {
  const pins: Pin[] = [];
  const groups: PinGroup[] = [];
  const groupMap = new Map<string, string>(); // name -> id

  const generateId = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const getOrCreateGroupId = (folderName: string): string => {
    if (groupMap.has(folderName)) {
      return groupMap.get(folderName)!;
    }
    const newId = generateId();
    groupMap.set(folderName, newId);
    groups.push({
      id: newId,
      name: folderName,
      position: groups.length
    });
    return newId;
  };

  // Helper to parse a Placemark element
  const parsePlacemark = (placemark: Element, groupId?: string) => {
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
      imageUrl: '', // Hard to extract reliably from raw KML description HTML
      color: 'blue',
      icon: 'default',
      groupId,
      position: pins.length
    });
  };

  // Recursive traversal to handle nested Folders correctly
  const traverse = (element: Element, currentGroupId?: string) => {
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      const tagName = child.tagName;

      if (tagName === 'Folder') {
        // Extract folder name from direct child
        let folderName = 'Untitled Group';
        const nameNode = Array.from(child.children).find(c => c.tagName === 'name');
        if (nameNode && nameNode.textContent) {
          folderName = nameNode.textContent;
        }

        const groupId = getOrCreateGroupId(folderName);
        traverse(child, groupId);
      } else if (tagName === 'Placemark') {
        parsePlacemark(child, currentGroupId);
      } else if (tagName === 'Document' || tagName === 'kml') {
        traverse(child, currentGroupId);
      }
    }
  };

  // Start traversal from root
  if (kmlDoc.firstElementChild) {
    traverse(kmlDoc.firstElementChild);
  }

  return { pins, groups };
};

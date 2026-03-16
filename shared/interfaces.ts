export type PinColor = 'blue' | 'red' | 'green' | 'orange' | 'violet';
export type PinIcon = 'default' | 'hotel' | 'restaurant' | 'airport' | 'park' | 'museum' | 'shopping' | 'camera';

export interface Pin {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  description?: string;
  imageUrl?: string;
  color?: PinColor;
  icon?: PinIcon;
  groupId?: string;
  position: number;
}

export interface PinGroup {
  id: string;
  name: string;
  position: number;
}

export interface MapData {
  id: string;
  name: string;
  groups: PinGroup[];
  pins: Pin[];
}

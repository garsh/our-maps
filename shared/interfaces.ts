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
}

export interface MapData {
  id: string;
  name: string;
  pins: Pin[];
}

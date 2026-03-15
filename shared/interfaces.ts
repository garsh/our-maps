export type PinColor = 'blue' | 'red' | 'green' | 'orange' | 'violet';

export interface Pin {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  description?: string;
  imageUrl?: string;
  color?: PinColor;
}

export interface MapData {
  id: string;
  name: string;
  pins: Pin[];
}

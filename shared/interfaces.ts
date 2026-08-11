export type PinColor = string;
export type PinIcon = 'default' | 'hotel' | 'restaurant' | 'airport' | 'bus' | 'shopping' | 'car' | 'gas' | 'charging' | 'boat' | 'train';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface MapPermission {
  userId: string;
  userEmail: string;
  userName: string;
  role: 'view' | 'edit';
}

export interface Pin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  description?: string;
  address?: string;
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
  ownerId: string;
  ownerName?: string;
  ownerEmail?: string;
  groups: PinGroup[];
  pins: Pin[];
  permissions?: MapPermission[];
  userRole?: 'view' | 'edit' | 'owner';
  lastAccessedAt?: string;
}

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
  userPicture?: string;
  role: 'view' | 'edit';
}

export interface Pin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  description?: string;
  address?: string;
  color?: PinColor;
  icon?: PinIcon;
  layerId?: string;
  position: number;
}

export interface PinLayer {
  id: string;
  name: string;
  position: number;
}

export interface MapData {
  id: string;
  name: string;
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerPicture?: string;
  layers: PinLayer[];
  pins: Pin[];
  customColors?: string[];
  permissions?: MapPermission[];
  userRole?: 'view' | 'edit' | 'owner';
  isPublic?: boolean;
  lastAccessedAt?: string;
  totalTiles?: number;
  completedTiles?: number;
  extractTotalBytes?: number;
}

export type LabelSortMode = 'last_accessed' | 'custom' | 'name' | 'created_at';

export interface UserLabel {
  id: string;
  userId?: string;
  name: string;
  sortMode: LabelSortMode;
  position: number;
  createdAt?: string;
}

export interface MapLabelAssignment {
  userId?: string;
  labelId: string;
  mapId: string;
  position: number;
  addedAt?: string;
}

export interface SystemLabelSetting {
  userId?: string;
  systemLabelId: string;
  sortMode: LabelSortMode;
}

export interface SystemLabelMapOrder {
  userId?: string;
  systemLabelId: string;
  mapId: string;
  position: number;
}

export * from './types/socket';
export * from './geoUtils';

import type { Pin, PinLayer } from '../interfaces';

export interface PinCreatePayload {
  mapId: string;
  layerId?: string | null;
  pin: Pin;
}

export interface PinUpdatePayload {
  mapId: string;
  pinId: string;
  updates: Partial<Pin> & { layerId?: string | null };
}

export interface PinDeletePayload {
  mapId: string;
  pinId: string;
}

export interface PinsReorderPayload {
  mapId: string;
  layerId?: string | null;
  pinIds: string[];
  insertIndex: number;
}

export interface PinMoveLayerPayload {
  mapId: string;
  pinIds: string[];
  targetLayerId?: string | null;
  destInsertIndex: number;
}

export interface LayerCreatePayload {
  mapId: string;
  layer: PinLayer;
}

export interface LayerUpdatePayload {
  mapId: string;
  layerId: string;
  updates: Partial<PinLayer>;
}

export interface LayerDeletePayload {
  mapId: string;
  layerId: string;
}

export interface LayersReorderPayload {
  mapId: string;
  layerOrder: string[];
}

export interface MapNameUpdatePayload {
  mapId: string;
  name: string;
}

export interface CustomColorsUpdatePayload {
  mapId: string;
  customColors: string[];
}

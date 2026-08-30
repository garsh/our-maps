import type { Collision, DroppableContainer, UniqueIdentifier } from '@dnd-kit/core';
import type { Pin } from '@shared/interfaces';
import { comparePinPositions, isSameLayer } from './reorderUtils';

export const DEFAULT_LAYER_COLLISION_ID = 'default';

export type CollisionRect = {
  top: number;
  bottom: number;
  height: number;
};

type RectLookup = { get(id: UniqueIdentifier): CollisionRect | undefined };

function findContainer(containers: DroppableContainer[], id: UniqueIdentifier) {
  return containers.find((container) => String(container.id) === String(id));
}

function isPinContainer(container: DroppableContainer | undefined): boolean {
  return container?.data.current?.type === 'pin';
}

function isLayerContainer(container: DroppableContainer | undefined, id: UniqueIdentifier): boolean {
  if (String(id) === DEFAULT_LAYER_COLLISION_ID) return true;
  return container?.data.current?.type === 'layer';
}

function withoutExcluded(hits: Collision[], excludeIds: Set<string>): Collision[] {
  return hits.filter((hit) => !excludeIds.has(String(hit.id)));
}

export type DragPark = {
  destLayerId: string | undefined;
  pinIds: string[];
};

/** Park the dragged pins at dest end for collision helpers — does not change React state. */
export function applyDragPark(pins: Pin[], park: DragPark | null): Pin[] {
  if (!park || park.pinIds.length === 0) return pins;
  const destPins = pins.filter(
    (p) => !park.pinIds.includes(p.id) && isSameLayer(p.layerId, park.destLayerId)
  );
  const maxPos = destPins.length > 0 ? Math.max(...destPins.map((p) => p.position)) : -1;
  return pins.map((p) => {
    const i = park.pinIds.indexOf(p.id);
    if (i === -1) return p;
    return { ...p, layerId: park.destLayerId, position: maxPos + 1 + i };
  });
}

export function pinsInLayer(pins: Pin[], layerKey: string, excludeIds: Set<string>): Pin[] {
  const layerId = layerKey === DEFAULT_LAYER_COLLISION_ID ? undefined : layerKey;
  return pins
    .filter((pin) => isSameLayer(pin.layerId, layerId) && !excludeIds.has(pin.id))
    .sort(comparePinPositions);
}

/**
 * Pin-drag collision:
 * 1. A pin under the pointer (not the dragged pin / bundle).
 * 2. A layer header under the pointer.
 * 3. closestCorners, still ignoring the dragged pin when possible.
 */
export function resolvePinDragCollision(args: {
  pointerHits: Collision[];
  closestHits: Collision[];
  droppableContainers: DroppableContainer[];
  excludeIds: Set<string>;
  droppableRects?: RectLookup;
  pointerY?: number | null;
  pins?: Pin[];
  layerOrder?: string[];
  isCollapsed?: (layerKey: string) => boolean;
  activeId?: string;
}): Collision[] {
  const { pointerHits, closestHits, droppableContainers, excludeIds } = args;

  const pointer = withoutExcluded(pointerHits, excludeIds);
  const pinHit = pointer.find((hit) => isPinContainer(findContainer(droppableContainers, hit.id)));
  if (pinHit) return [pinHit];

  const layerHit = pointer.find((hit) => isLayerContainer(findContainer(droppableContainers, hit.id), hit.id));
  if (layerHit) return [layerHit];

  const closest = withoutExcluded(closestHits, excludeIds);
  return closest.length > 0 ? closest : closestHits;
}

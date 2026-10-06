import type { Pin, PinLayer } from '@shared/interfaces';
import { insertIdsAt, insertIndexAfterMove } from '@shared/pinOrder';

export function isSameLayer(l1?: string | null, l2?: string | null): boolean {
  if (!l1 && !l2) return true;
  return l1 === l2;
}

export function comparePinPositions(a: Pin, b: Pin): number {
  if (a.position !== b.position) {
    return a.position - b.position;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Reorders a list of pins based on a drag-and-drop event.
 */
export function reorderPins(
    prevPins: Pin[],
    activeId: string,
    overId: string,
    overType: 'pin' | 'layer',
    overLayerId: string | undefined,
    selectedNavIds: Set<string>,
    collapsedLayerIds?: Set<string | null>
): Pin[] {
    const movingSet = selectedNavIds.has(activeId) 
        ? selectedNavIds 
        : new Set([activeId]);
    
    // If we dropped on something that is part of the moving bundle,
    // we should keep the current visual state.
    if (movingSet.has(overId)) {
        return prevPins;
    }

    const otherPins: Pin[] = [];
    const pinMap = new Map<string, Pin>();
    for (const p of prevPins) {
        if (movingSet.has(p.id)) {
            pinMap.set(p.id, p);
        } else {
            otherPins.push(p);
        }
    }

    const movedPins: Pin[] = [];
    for (const id of movingSet) {
        const p = pinMap.get(id);
        if (p) movedPins.push(p);
    }
    
    let targetIndex: number;
    if (overType === 'pin') {
        const overIndex = otherPins.findIndex(p => p.id === overId);
        targetIndex = overIndex !== -1 ? overIndex + 1 : otherPins.length;
    } else {
        const targetLayerId = overLayerId === 'default' ? undefined : overLayerId;
        const isCollapsed = collapsedLayerIds?.has(targetLayerId ?? null);

        if (isCollapsed) {
            // Dropped on a closed (collapsed) layer: insert at the END of that layer
            let lastPinIndex = -1;
            for (let i = otherPins.length - 1; i >= 0; i--) {
                if (isSameLayer(otherPins[i].layerId, targetLayerId)) {
                    lastPinIndex = i;
                    break;
                }
            }
            targetIndex = lastPinIndex !== -1 ? lastPinIndex + 1 : otherPins.length;
        } else {
            // Dropped on an open (expanded) layer header: insert at the BEGINNING (top) of that layer
            const firstPinIndex = otherPins.findIndex(p => isSameLayer(p.layerId, targetLayerId));
            if (firstPinIndex !== -1) {
                targetIndex = firstPinIndex;
            } else {
                targetIndex = otherPins.length;
            }
        }
    }

    const destLayerId = overLayerId === 'default' ? undefined : overLayerId;
    const updatedMovedPins = movedPins.map(p => ({
        ...p,
        layerId: destLayerId
    }));

    const result = [...otherPins];
    result.splice(Math.max(0, targetIndex), 0, ...updatedMovedPins);

    const crossesLayer = movedPins.some(p => !isSameLayer(p.layerId, destLayerId));

    if (crossesLayer) {
        const movedIdSet = new Set(movedPins.map(p => p.id));
        const destPins = result.filter(p => isSameLayer(p.layerId, destLayerId));
        let firstMoved = -1;
        let lastStaying = -1;
        destPins.forEach((p, i) => {
            if (movedIdSet.has(p.id)) {
                if (firstMoved === -1) firstMoved = i;
            } else {
                lastStaying = i;
            }
        });

        // A drop at the end keeps existing destination positions.
        if (firstMoved === -1 || firstMoved > lastStaying) {
            let maxPosition = -1;
            for (const p of destPins) {
                if (!movedIdSet.has(p.id) && p.position > maxPosition) maxPosition = p.position;
            }
            let nextPosition = maxPosition + 1;
            const assigned = new Map<string, number>();
            for (const p of destPins) {
                if (movedIdSet.has(p.id)) assigned.set(p.id, nextPosition++);
            }
            return result.map(p => {
                const position = assigned.get(p.id);
                if (position === undefined) return p;
                return { ...p, position };
            });
        }
    }

    // Same-layer reorder and a middle insert rewrite this layer only.
    let position = 0;
    return result.map(p => {
        if (!isSameLayer(p.layerId, destLayerId)) return p;
        return { ...p, position: position++ };
    });
}

/**
 * Reorders a list of layers based on a drag-and-drop event.
 */
export function reorderLayers(
    prevLayers: PinLayer[],
    activeId: string,
    overId: string
): PinLayer[] {
    if (activeId === overId) return prevLayers;
    if (activeId === 'default' || overId === 'default') return prevLayers;
    
    const otherLayers = prevLayers.filter((i) => i.id !== activeId);
    const movedLayer = prevLayers.find((i) => i.id === activeId);
    if (!movedLayer) return prevLayers;
    
    let targetIndex: number;
    if (overId === 'layer-top') {
        targetIndex = 0;
    } else {
        const overIndex = otherLayers.findIndex((i) => i.id === overId);
        if (overIndex === -1) return prevLayers;
        targetIndex = overIndex + 1;
    }
    
    const result = [...otherLayers];
    result.splice(Math.max(0, targetIndex), 0, movedLayer);
    return result.map((item, index) => ({ ...item, position: index }));
}

export function applyRemotePinsReorder(
  pins: Pin[],
  layerId: string | undefined,
  pinIds: string[],
  insertIndex: number
): Pin[] {
  const layerPins = pins.filter((p) => isSameLayer(p.layerId, layerId)).sort(comparePinPositions);
  const others = pins.filter((p) => !isSameLayer(p.layerId, layerId));
  const layerIdSet = new Set(layerPins.map((p) => p.id));
  const moved = pinIds.filter((id) => layerIdSet.has(id));
  const newOrder = insertIdsAt(layerPins.map((p) => p.id), moved, insertIndex);
  const pinMap = new Map(layerPins.map((p) => [p.id, p]));
  const reordered = newOrder.map((id, idx) => ({ ...pinMap.get(id)!, position: idx }));
  return [...others, ...reordered];
}

export function applyRemotePinMoveLayer(
  pins: Pin[],
  pinIds: string[],
  targetLayerId: string | undefined,
  destInsertIndex: number
): Pin[] {
  const seen = new Set<string>();
  const movedPins: Pin[] = [];
  for (const id of pinIds) {
    if (seen.has(id)) continue;
    const pin = pins.find((p) => p.id === id);
    if (!pin) continue;
    seen.add(id);
    movedPins.push(pin);
  }
  if (movedPins.length === 0) return pins;

  const destExisting = pins
    .filter((p) => !seen.has(p.id) && isSameLayer(p.layerId, targetLayerId))
    .sort(comparePinPositions);
  const appends = destInsertIndex >= destExisting.length;

  const positionById = new Map<string, number>();
  if (appends) {
    let maxPosition = -1;
    for (const p of destExisting) {
      if (p.position > maxPosition) maxPosition = p.position;
    }
    let nextPosition = maxPosition + 1;
    for (const p of movedPins) positionById.set(p.id, nextPosition++);
  } else {
    const destOrder = insertIdsAt(
      destExisting.map((p) => p.id),
      movedPins.map((p) => p.id),
      destInsertIndex
    );
    destOrder.forEach((id, idx) => positionById.set(id, idx));
  }

  return pins.map((p) => {
    const position = positionById.get(p.id);
    const moved = seen.has(p.id);
    if (!moved && position === undefined) return p;
    return {
      ...p,
      layerId: moved ? targetLayerId : p.layerId,
      position: position === undefined ? p.position : position,
    };
  });
}

/**
 * Dispatches socket events for moving pins between layers or reordering within a layer.
 */
export function emitPinMoveOrReorderEvents(
  socket: { emit: (event: string, data: any, callback?: any) => void } | null | undefined,
  mapId: string,
  allPins: Pin[],
  movedPinIds: string[],
  startLayersMap: Map<string, string | undefined>,
  targetLayerId: string | undefined,
  callback?: (res: any) => void
) {
  if (!socket || !mapId || movedPinIds.length === 0) {
    if (callback) callback({ success: true });
    return;
  }

  const changedLayerPins = movedPinIds.filter(
    (pId) => !isSameLayer(startLayersMap.get(pId), targetLayerId)
  );
  const destLayerPins = allPins
    .filter((p) => isSameLayer(p.layerId, targetLayerId))
    .sort(comparePinPositions);
  const destIds = destLayerPins.map((p) => p.id);

  if (changedLayerPins.length > 0) {
    // The whole dropped block, including pins that were already in the destination.
    const movedSet = new Set(movedPinIds);
    const compactIds = destIds.filter((id) => movedSet.has(id));
    if (compactIds.length === 0) {
      if (callback) callback({ success: true });
      return;
    }
    socket.emit('pin-move-layer', {
      mapId,
      pinIds: compactIds,
      targetLayerId: targetLayerId === undefined ? null : targetLayerId,
      destInsertIndex: insertIndexAfterMove(destIds, compactIds),
    }, callback);
  } else {
    const movedSet = new Set(movedPinIds);
    const compactIds = destIds.filter((id) => movedSet.has(id));
    if (compactIds.length === 0) {
      if (callback) callback({ success: true });
      return;
    }
    socket.emit('pins-reorder', {
      mapId,
      layerId: targetLayerId === undefined ? null : targetLayerId,
      pinIds: compactIds,
      insertIndex: insertIndexAfterMove(destIds, compactIds),
    }, callback);
  }
}


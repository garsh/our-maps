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

    const updatedMovedPins = movedPins.map(p => ({ 
        ...p, 
        layerId: overLayerId === 'default' ? undefined : overLayerId
    }));
    
    const result = [...otherPins];
    result.splice(Math.max(0, targetIndex), 0, ...updatedMovedPins);

    const layerPositions = new Map<string | null, number>();
    return result.map((p) => {
        const layerKey = p.layerId || null;
        const pos = layerPositions.get(layerKey) || 0;
        layerPositions.set(layerKey, pos + 1);
        return { ...p, position: pos };
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
  const movedSet = new Set(pinIds);
  const sourceLayerIds = new Set(
    pins.filter((p) => movedSet.has(p.id)).map((p) => p.layerId)
  );

  const destExisting = pins
    .filter((p) => !movedSet.has(p.id) && isSameLayer(p.layerId, targetLayerId))
    .sort(comparePinPositions);
  const movedPins = pinIds
    .map((id) => pins.find((p) => p.id === id))
    .filter((p): p is Pin => !!p)
    .map((p) => ({ ...p, layerId: targetLayerId }));
  const destOrder = insertIdsAt(destExisting.map((p) => p.id), movedPins.map((p) => p.id), destInsertIndex);
  const destMap = new Map<string, Pin>([
    ...destExisting.map((p) => [p.id, p] as const),
    ...movedPins.map((p) => [p.id, p] as const),
  ]);
  const destReordered = destOrder.map((id, idx) => ({
    ...destMap.get(id)!,
    layerId: targetLayerId,
    position: idx,
  }));
  const destIdSet = new Set(destOrder);

  const rest: Pin[] = [];
  const bySource = new Map<string | undefined, Pin[]>();
  for (const p of pins) {
    if (destIdSet.has(p.id) || movedSet.has(p.id)) continue;
    if (sourceLayerIds.has(p.layerId) && !isSameLayer(p.layerId, targetLayerId)) {
      const list = bySource.get(p.layerId) || [];
      list.push(p);
      bySource.set(p.layerId, list);
    } else {
      rest.push(p);
    }
  }

  const reindexedSources: Pin[] = [];
  bySource.forEach((list) => {
    list.sort(comparePinPositions);
    list.forEach((p, idx) => {
      reindexedSources.push({ ...p, position: idx });
    });
  });

  return [...rest, ...destReordered, ...reindexedSources];
}

/**
 * Dispatches socket events for moving pins between layers or reordering within a layer.
 */
export function emitPinMoveOrReorderEvents(
  socket: { emit: (event: string, data: any) => void } | null | undefined,
  mapId: string,
  allPins: Pin[],
  movedPinIds: string[],
  startLayersMap: Map<string, string | undefined>,
  targetLayerId: string | undefined,
  _preferredPrimarySourceLayer?: string | undefined
) {
  if (!socket || !mapId || movedPinIds.length === 0) return;

  const changedLayerPins = movedPinIds.filter(
    (pId) => !isSameLayer(startLayersMap.get(pId), targetLayerId)
  );
  const destLayerPins = allPins
    .filter((p) => isSameLayer(p.layerId, targetLayerId))
    .sort(comparePinPositions);
  const destIds = destLayerPins.map((p) => p.id);

  if (changedLayerPins.length > 0) {
    const movedSet = new Set(changedLayerPins);
    const compactIds = destIds.filter((id) => movedSet.has(id));
    if (compactIds.length === 0) return;
    socket.emit('pin-move-layer', {
      mapId,
      pinIds: compactIds,
      targetLayerId: targetLayerId === undefined ? null : targetLayerId,
      destInsertIndex: insertIndexAfterMove(destIds, compactIds),
    });
  } else {
    const movedSet = new Set(movedPinIds);
    const compactIds = destIds.filter((id) => movedSet.has(id));
    if (compactIds.length === 0) return;
    socket.emit('pins-reorder', {
      mapId,
      layerId: targetLayerId === undefined ? null : targetLayerId,
      pinIds: compactIds,
      insertIndex: insertIndexAfterMove(destIds, compactIds),
    });
  }
}


import type { Pin, PinLayer } from '@shared/interfaces';

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
    selectedNavIds: Set<string>
): Pin[] {
    const pinsToMoveIds = selectedNavIds.has(activeId) 
        ? Array.from(selectedNavIds) 
        : [activeId];
    
    // If we dropped on something that is part of the moving bundle,
    // we should keep the current visual state.
    if (pinsToMoveIds.includes(overId)) {
        return prevPins;
    }

    const movedPins = pinsToMoveIds.map(id => prevPins.find(p => p.id === id)).filter(Boolean) as Pin[];
    const otherPins = prevPins.filter(p => !pinsToMoveIds.includes(p.id));
    
    let targetIndex: number;
    if (overType === 'pin') {
        const overIndex = otherPins.findIndex(p => p.id === overId);
        targetIndex = overIndex !== -1 ? overIndex + 1 : otherPins.length;
    } else {
        // Dropped on a layer header: insert at the beginning (top) of that layer
        const targetLayerId = overLayerId === 'default' ? undefined : overLayerId;
        const firstPinIndex = otherPins.findIndex(p => isSameLayer(p.layerId, targetLayerId));
        if (firstPinIndex !== -1) {
            targetIndex = firstPinIndex;
        } else {
            targetIndex = otherPins.length;
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

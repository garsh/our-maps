import type { Pin, PinGroup } from '@shared/interfaces';
import { arrayMove } from '@dnd-kit/sortable';

/**
 * Reorders a list of pins based on a drag-and-drop event.
 */
export function reorderPins(
    prevPins: Pin[],
    activeId: string,
    overId: string,
    overType: 'pin' | 'group',
    overGroupId: string | undefined,
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
    
    const activeIndex = prevPins.findIndex(p => p.id === activeId);
    const overIndex = prevPins.findIndex(p => p.id === overId);
    
    let targetIndex;
    if (overType === 'pin') {
        targetIndex = otherPins.findIndex(p => p.id === overId);
        // Standard sortable behavior: land AFTER the target if we were dragging DOWN
        if (activeIndex < overIndex) {
            targetIndex += 1;
        }
    } else {
        // Dropped on a group header: append to the end of that group
        const targetGroupId = overGroupId === 'default' ? undefined : overGroupId;
        const pinsInTargetGroup = otherPins.filter(p => p.groupId === targetGroupId);
        if (pinsInTargetGroup.length > 0) {
            const lastPin = pinsInTargetGroup[pinsInTargetGroup.length - 1];
            targetIndex = otherPins.findIndex(p => p.id === lastPin.id) + 1;
        } else {
            targetIndex = otherPins.length;
        }
    }

    const updatedMovedPins = movedPins.map(p => ({ 
        ...p, 
        groupId: overGroupId === 'default' ? undefined : overGroupId
    }));
    
    const result = [...otherPins];
    result.splice(Math.max(0, targetIndex), 0, ...updatedMovedPins);
    return result.map((p, i) => ({ ...p, position: i }));
}

/**
 * Reorders a list of groups based on a drag-and-drop event.
 */
export function reorderGroups(
    prevGroups: PinGroup[],
    activeId: string,
    overId: string
): PinGroup[] {
    if (activeId === overId) return prevGroups;
    
    const oldIndex = prevGroups.findIndex((i) => i.id === activeId);
    const newIndex = prevGroups.findIndex((i) => i.id === overId);
    
    if (oldIndex === -1 || newIndex === -1) return prevGroups;
    
    const newItems = arrayMove(prevGroups, oldIndex, newIndex);
    return newItems.map((item, index) => ({ ...item, position: index }));
}

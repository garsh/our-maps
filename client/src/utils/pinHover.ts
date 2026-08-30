import { useEffect, useState } from 'react';

export const PIN_HOVER_CLASS = 'pin-hovered';

let hoveredId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export function getHoveredPinId(): string | null {
  return hoveredId;
}

function applyListHoverClass(id: string | null) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`.${PIN_HOVER_CLASS}`).forEach((el) => {
    el.classList.remove(PIN_HOVER_CLASS);
  });
  if (id) {
    document.getElementById(`pin-${id}`)?.classList.add(PIN_HOVER_CLASS);
  }
}

function notify(id: string | null) {
  listeners.forEach((listener) => listener(id));
}

export function setHoveredPin(id: string | null, leavingPinId?: string) {
  if (id === null) {
    if (leavingPinId && hoveredId !== leavingPinId) return;
    if (hoveredId === null) return;
    hoveredId = null;
  } else {
    if (hoveredId === id) return;
    hoveredId = id;
  }
  applyListHoverClass(hoveredId);
  notify(hoveredId);
}

export function clearHoveredPin() {
  setHoveredPin(null);
}

export function subscribeHoveredPin(listener: (id: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIsPinHovered(pinId: string): boolean {
  const [isHovered, setIsHovered] = useState(() => hoveredId === pinId);

  useEffect(() => {
    setIsHovered(hoveredId === pinId);
    return subscribeHoveredPin((id) => {
      setIsHovered(id === pinId);
    });
  }, [pinId]);

  return isHovered;
}

export function resetPinHoverForTests() {
  hoveredId = null;
  listeners.clear();
  applyListHoverClass(null);
}

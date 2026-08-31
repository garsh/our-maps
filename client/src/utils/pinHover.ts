import { useEffect, useState } from 'react';

export const PIN_HOVER_CLASS = 'pin-hovered';

let hoveredId: string | null = null;
let lastHoveredEl: HTMLElement | null = null;
let lastPointerType: string = 'mouse';
const listeners = new Set<(id: string | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.pointerType) lastPointerType = e.pointerType;
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (e.pointerType) lastPointerType = e.pointerType;
    },
    { capture: true, passive: true }
  );
}

export function hasFinePointer(): boolean {
  if (typeof window === 'undefined') return false;
  if (lastPointerType === 'touch') return false;
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (mq && typeof mq.matches === 'boolean') {
      return mq.matches;
    }
  }
  return true;
}

export function setLastPointerTypeForTests(type: string) {
  lastPointerType = type;
}

export function getHoveredPinId(): string | null {
  return hoveredId;
}

function applyListHoverClass(id: string | null) {
  if (typeof document === 'undefined') return;
  if (lastHoveredEl) {
    lastHoveredEl.classList.remove(PIN_HOVER_CLASS);
    lastHoveredEl = null;
  }
  if (id) {
    const el = document.getElementById(`pin-${id}`);
    if (el) {
      el.classList.add(PIN_HOVER_CLASS);
      lastHoveredEl = el;
    }
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
  lastHoveredEl = null;
  lastPointerType = 'mouse';
  listeners.clear();
  if (typeof document !== 'undefined') {
    document.querySelectorAll(`.${PIN_HOVER_CLASS}`).forEach((el) => {
      el.classList.remove(PIN_HOVER_CLASS);
    });
  }
}

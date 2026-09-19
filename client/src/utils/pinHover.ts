import { useEffect, useState } from 'react';

export const PIN_HOVER_CLASS = 'pin-hovered';

let hoveredId: string | null = null;
let lastHoveredEls: HTMLElement[] = [];
let coLocatedById = new Map<string, string[]>();
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

let finePointerMedia: MediaQueryList | null = null;

function getFinePointerMediaQuery(): MediaQueryList | null {
  if (finePointerMedia) return finePointerMedia;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      finePointerMedia = window.matchMedia('(hover: hover) and (pointer: fine)');
    } catch {}
  }
  return finePointerMedia;
}

export function hasFinePointer(): boolean {
  if (typeof window === 'undefined') return false;
  if (lastPointerType === 'touch') return false;
  const mq = getFinePointerMediaQuery();
  if (mq && typeof mq.matches === 'boolean') {
    return mq.matches;
  }
  return true;
}

export function setLastPointerTypeForTests(type: string) {
  lastPointerType = type;
}

export function getHoveredPinId(): string | null {
  return hoveredId;
}

export function syncCoLocatedPins(pins: Array<{ id: string; lat: number; lng: number }>) {
  const groups = new Map<string, string[]>();
  for (const pin of pins) {
    const key = `${pin.lat},${pin.lng}`;
    const group = groups.get(key);
    if (group) group.push(pin.id);
    else groups.set(key, [pin.id]);
  }
  const next = new Map<string, string[]>();
  for (const group of groups.values()) {
    for (const id of group) next.set(id, group);
  }
  coLocatedById = next;
}

function hoverGroupIds(id: string): string[] {
  return coLocatedById.get(id) ?? [id];
}

function applyListHoverClass(id: string | null) {
  if (typeof document === 'undefined') return;
  for (const el of lastHoveredEls) {
    el.classList.remove(PIN_HOVER_CLASS);
  }
  lastHoveredEls = [];
  if (!id) return;
  for (const hoverId of hoverGroupIds(id)) {
    const el = document.getElementById(`pin-${hoverId}`);
    if (el) {
      el.classList.add(PIN_HOVER_CLASS);
      lastHoveredEls.push(el);
    }
  }
}

export function refreshHoveredPinListClasses() {
  applyListHoverClass(hoveredId);
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

export function useHoveredPinId(): string | null {
  const [currentHoveredId, setCurrentHoveredId] = useState<string | null>(() => hoveredId);

  useEffect(() => {
    return subscribeHoveredPin((id) => {
      setCurrentHoveredId(id);
    });
  }, []);

  return currentHoveredId;
}

export function resetPinHoverForTests() {
  hoveredId = null;
  lastHoveredEls = [];
  coLocatedById = new Map();
  lastPointerType = 'mouse';
  finePointerMedia = null;
  listeners.clear();
  if (typeof document !== 'undefined') {
    document.querySelectorAll(`.${PIN_HOVER_CLASS}`).forEach((el) => {
      el.classList.remove(PIN_HOVER_CLASS);
    });
  }
}

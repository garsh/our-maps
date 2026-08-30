let bounds: string | null = null;
const listeners = new Set<(next: string | null) => void>();

export function getMapViewportBounds(): string | null {
  return bounds;
}

export function setMapViewportBounds(next: string | null) {
  if (bounds === next) return;
  bounds = next;
  listeners.forEach((listener) => listener(bounds));
}

export function subscribeMapViewportBounds(listener: (next: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetMapViewportBoundsForTests() {
  bounds = null;
  listeners.clear();
}

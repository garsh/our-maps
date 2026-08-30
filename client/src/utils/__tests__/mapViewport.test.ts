import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMapViewportBounds,
  setMapViewportBounds,
  subscribeMapViewportBounds,
  resetMapViewportBoundsForTests,
} from '../mapViewport';

describe('mapViewport', () => {
  beforeEach(() => {
    resetMapViewportBoundsForTests();
  });

  afterEach(() => {
    resetMapViewportBoundsForTests();
  });

  it('does not notify subscribers when the bounds string is unchanged', () => {
    const listener = vi.fn();
    subscribeMapViewportBounds(listener);

    setMapViewportBounds('1,2,3,4');
    expect(getMapViewportBounds()).toBe('1,2,3,4');
    expect(listener).toHaveBeenCalledTimes(1);

    setMapViewportBounds('1,2,3,4');
    expect(listener).toHaveBeenCalledTimes(1);

    setMapViewportBounds('5,6,7,8');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getMapViewportBounds()).toBe('5,6,7,8');
  });
});

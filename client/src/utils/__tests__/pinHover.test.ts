import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  PIN_HOVER_CLASS,
  getHoveredPinId,
  setHoveredPin,
  clearHoveredPin,
  subscribeHoveredPin,
  useIsPinHovered,
  useHoveredPinId,
  resetPinHoverForTests,
  hasFinePointer,
  setLastPointerTypeForTests,
} from '../pinHover';

describe('pinHover', () => {
  beforeEach(() => {
    resetPinHoverForTests();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    resetPinHoverForTests();
    document.body.innerHTML = '';
  });

  it('notifies subscribers only when the hovered id actually changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHoveredPin(listener);

    setHoveredPin('pin-a');
    expect(getHoveredPinId()).toBe('pin-a');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('pin-a');

    setHoveredPin('pin-a');
    expect(listener).toHaveBeenCalledTimes(1);

    setHoveredPin('pin-b');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getHoveredPinId()).toBe('pin-b');

    unsubscribe();
    setHoveredPin(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores leave events that do not match the current hovered pin', () => {
    const listener = vi.fn();
    subscribeHoveredPin(listener);

    setHoveredPin('pin-a');
    setHoveredPin(null, 'pin-b');
    expect(getHoveredPinId()).toBe('pin-a');
    expect(listener).toHaveBeenCalledTimes(1);

    setHoveredPin(null, 'pin-a');
    expect(getHoveredPinId()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('toggles the list highlight class on #pin-{id} without requiring React state', () => {
    const rowA = document.createElement('li');
    rowA.id = 'pin-a';
    const rowB = document.createElement('li');
    rowB.id = 'pin-b';
    document.body.append(rowA, rowB);

    setHoveredPin('a');
    expect(rowA.classList.contains(PIN_HOVER_CLASS)).toBe(true);
    expect(rowB.classList.contains(PIN_HOVER_CLASS)).toBe(false);

    setHoveredPin('b');
    expect(rowA.classList.contains(PIN_HOVER_CLASS)).toBe(false);
    expect(rowB.classList.contains(PIN_HOVER_CLASS)).toBe(true);

    clearHoveredPin();
    expect(rowB.classList.contains(PIN_HOVER_CLASS)).toBe(false);
  });

  it('only re-renders a pin hook when that pin is the hovered one', () => {
    const { result: pinA } = renderHook(() => useIsPinHovered('pin-a'));
    const { result: pinB } = renderHook(() => useIsPinHovered('pin-b'));

    expect(pinA.current).toBe(false);
    expect(pinB.current).toBe(false);

    act(() => setHoveredPin('pin-a'));
    expect(pinA.current).toBe(true);
    expect(pinB.current).toBe(false);

    act(() => setHoveredPin('pin-b'));
    expect(pinA.current).toBe(false);
    expect(pinB.current).toBe(true);
  });

  it('subscribes and updates useHoveredPinId correctly', () => {
    const { result } = renderHook(() => useHoveredPinId());
    expect(result.current).toBeNull();

    act(() => setHoveredPin('pin-test'));
    expect(result.current).toBe('pin-test');

    act(() => clearHoveredPin());
    expect(result.current).toBeNull();
  });

  it('detects fine pointer capability vs touch pointer correctly', () => {
    setLastPointerTypeForTests('mouse');
    expect(hasFinePointer()).toBe(true);

    setLastPointerTypeForTests('touch');
    expect(hasFinePointer()).toBe(false);

    setLastPointerTypeForTests('mouse');
    expect(hasFinePointer()).toBe(true);
  });
});

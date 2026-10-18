import { afterEach, describe, expect, it, vi } from 'vitest';
import { GripTouchSensor } from '../gripTouchSensor';

function flushMutations() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function touchStart(touches = 1) {
  const event = new Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: touches }, () => ({ clientX: 1, clientY: 2 })),
  });
  return event;
}

function mountGrip() {
  const grip = document.createElement('div');
  grip.setAttribute('data-drag-handle', '');
  const inner = document.createElement('span');
  grip.append(inner);
  document.body.append(grip);
  return { grip, inner };
}

function pointer(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: 'touch',
    isPrimary: true,
    clientX: 8,
    clientY: 12,
    ...init,
  });
}

function createSensor(
  target: Element,
  handlers: {
    onCancel?: () => void;
    onEnd?: () => void;
    onAbort?: () => void;
  } = {}
) {
  const event = pointer('pointerdown');
  target.dispatchEvent(event);
  const node = { current: target as HTMLElement };
  return new GripTouchSensor({
    active: 'pin',
    activeNode: {
      id: 'pin',
      key: 'pin',
      node,
      activatorNode: node,
      data: { current: {} },
    },
    event,
    context: { current: null } as never,
    options: { activationConstraint: { distance: 5 } },
    onAbort: handlers.onAbort ?? (() => {}),
    onPending: () => {},
    onStart: () => {},
    onCancel: handlers.onCancel ?? (() => {}),
    onMove: () => {},
    onEnd: handlers.onEnd ?? (() => {}),
  });
}

describe('grip touch scroll lock', () => {
  let release: (() => void) | null = null;

  afterEach(() => {
    release?.();
    release = null;
    document.body.replaceChildren();
  });

  it('prevents default for a single touch on the grip after the root has seen the event', () => {
    release = GripTouchSensor.setup();
    const root = document.createElement('div');
    const { grip, inner } = mountGrip();
    root.append(grip);
    document.body.append(root);

    let seenPrevented = true;
    root.addEventListener('touchstart', (event) => {
      seenPrevented = event.defaultPrevented;
    });

    const event = touchStart();
    inner.dispatchEvent(event);

    expect(seenPrevented).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a touch on the row, a second finger, and an uncancelable touch alone', () => {
    release = GripTouchSensor.setup();
    const { grip } = mountGrip();
    const row = document.createElement('div');
    document.body.append(row);

    const onRow = touchStart();
    row.dispatchEvent(onRow);
    expect(onRow.defaultPrevented).toBe(false);

    const pinch = touchStart(2);
    grip.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);

    const locked = touchStart();
    Object.defineProperty(locked, 'cancelable', { value: false });
    grip.dispatchEvent(locked);
    expect(locked.defaultPrevented).toBe(false);
  });

  it('removes the listener after the last setup teardown', () => {
    const first = GripTouchSensor.setup();
    const second = GripTouchSensor.setup();
    const { inner } = mountGrip();

    first();
    const stillLocked = touchStart();
    inner.dispatchEvent(stillLocked);
    expect(stillLocked.defaultPrevented).toBe(true);

    second();
    const unlocked = touchStart();
    inner.dispatchEvent(unlocked);
    expect(unlocked.defaultPrevented).toBe(false);
  });
});

describe('GripTouchSensor gesture end', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('cancels once when Chrome sends pointercancel without touchcancel', () => {
    const { inner } = mountGrip();
    const onCancel = vi.fn();
    const onEnd = vi.fn();
    const onAbort = vi.fn();
    createSensor(inner, { onCancel, onEnd, onAbort });

    document.dispatchEvent(pointer('pointercancel'));
    document.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    document.dispatchEvent(pointer('pointerup'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('drops once on a primary touch pointerup and ignores mouse and extra pointerups', () => {
    const { inner } = mountGrip();
    const onCancel = vi.fn();
    const onEnd = vi.fn();
    createSensor(inner, { onCancel, onEnd });

    document.dispatchEvent(pointer('pointerup', { pointerType: 'mouse' }));
    document.dispatchEvent(pointer('pointerup', { isPrimary: false }));
    expect(onEnd).not.toHaveBeenCalled();

    document.dispatchEvent(pointer('pointerup'));
    inner.dispatchEvent(new Event('touchend', { bubbles: true }));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('still ends after the original touch target is replaced', () => {
    const { grip, inner } = mountGrip();
    const onCancel = vi.fn();
    const onEnd = vi.fn();
    createSensor(inner, { onCancel, onEnd });

    inner.remove();
    return flushMutations().then(() => {
      expect(onCancel).not.toHaveBeenCalled();
      expect(grip.isConnected).toBe(true);
      document.dispatchEvent(pointer('pointerup'));
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });

  it('cancels when the grip leaves the document', () => {
    const { grip, inner } = mountGrip();
    const onCancel = vi.fn();
    const onEnd = vi.fn();
    createSensor(inner, { onCancel, onEnd });

    grip.remove();
    return flushMutations().then(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onEnd).not.toHaveBeenCalled();
    });
  });

  it('cancels a touch whose grip is already gone', () => {
    const { grip, inner } = mountGrip();
    grip.remove();
    const onCancel = vi.fn();
    createSensor(inner, { onCancel });
    return flushMutations().then(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});

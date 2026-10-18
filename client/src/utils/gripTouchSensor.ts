import { TouchSensor } from '@dnd-kit/core';

const DRAG_HANDLE_SELECTOR = '[data-drag-handle]';

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function gripFromEventTarget(target: EventTarget | null): Element | null {
  return elementFromTarget(target)?.closest(DRAG_HANDLE_SELECTOR) ?? null;
}

/**
 * Chrome can ignore the grip's touch-action: none inside the zoomed sheet and
 * turn the swipe into a list scroll. preventDefault on touchstart stops that.
 * This listens on document in the bubble phase so it runs after dnd-kit has
 * accepted the touch. The React root listener is passive, and defaultPrevented
 * before that acceptance makes the sensor ignore the touch.
 */
function preventGripTouchScroll(event: TouchEvent): void {
  if (event.touches?.length !== 1) return;
  if (!gripFromEventTarget(event.target)) return;
  if (event.cancelable) event.preventDefault();
}

let scrollLocks = 0;

function bindGripTouchScrollLock(): () => void {
  if (scrollLocks === 0) {
    document.addEventListener('touchstart', preventGripTouchScroll, { passive: false });
  }
  scrollLocks += 1;
  return () => {
    scrollLocks -= 1;
    if (scrollLocks > 0) return;
    scrollLocks = 0;
    document.removeEventListener('touchstart', preventGripTouchScroll);
  };
}

interface SensorEnd {
  handleCancel(): void;
  handleEnd(): void;
}

/**
 * TouchSensor finishes only on touchend/touchcancel, and those listeners sit
 * on the touch target. Android Chrome often aborts a grip swipe with
 * pointercancel and no touchcancel, or drops the target when the grip
 * unmounts. DndContext then ignores later grips until the page is reloaded.
 * A finger-up still drops. A cancelled or removed grip ends the attempt
 * without leaving that flag set.
 */
export class GripTouchSensor extends TouchSensor {
  static activators = TouchSensor.activators;

  static setup() {
    const releaseScroll = bindGripTouchScrollLock();
    const releaseTouch = TouchSensor.setup();
    return () => {
      releaseScroll();
      releaseTouch();
    };
  }

  constructor(props: ConstructorParameters<typeof TouchSensor>[0]) {
    super(props);
    const sensor = this as unknown as SensorEnd;

    let settled = false;
    const targetNode = props.event.target;
    const doc = targetNode instanceof Node ? (targetNode.ownerDocument ?? document) : document;

    const finish = (cancel: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cancel) sensor.handleCancel();
      else sensor.handleEnd();
    };

    const onPointerEnd = (event: Event) => {
      if (!(event instanceof PointerEvent)) return;
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      if (event.type === 'pointercancel') {
        finish(true);
        return;
      }
      if (!event.isPrimary) return;
      finish(false);
    };

    const onTouchEnd = (event: Event) => {
      finish(event.type === 'touchcancel');
    };

    const grip = gripFromEventTarget(props.event.target);
    const onMutations = () => {
      if (grip && !grip.isConnected) finish(true);
    };
    const observer = grip && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(onMutations)
      : null;

    const cleanup = () => {
      doc.removeEventListener('pointerup', onPointerEnd, true);
      doc.removeEventListener('pointercancel', onPointerEnd, true);
      doc.removeEventListener('touchend', onTouchEnd, true);
      doc.removeEventListener('touchcancel', onTouchEnd, true);
      observer?.disconnect();
    };

    doc.addEventListener('pointerup', onPointerEnd, true);
    doc.addEventListener('pointercancel', onPointerEnd, true);
    doc.addEventListener('touchend', onTouchEnd, true);
    doc.addEventListener('touchcancel', onTouchEnd, true);
    if (observer && doc.body) {
      observer.observe(doc.body, { childList: true, subtree: true });
    }
    if (grip && !grip.isConnected) {
      queueMicrotask(() => finish(true));
    }
  }
}

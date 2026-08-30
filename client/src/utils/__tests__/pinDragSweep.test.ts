import { describe, it, expect } from 'vitest';
import { closestCorners, pointerWithin } from '@dnd-kit/core';
import type { ClientRect, DroppableContainer, UniqueIdentifier } from '@dnd-kit/core';
import type { Pin } from '@shared/interfaces';
import { applyDragPark, resolvePinDragCollision } from '../pinDragCollision';
import { comparePinPositions, isSameLayer, reorderPins } from '../reorderUtils';

const HEADER_H = 20;
const PIN_H = 24;
const LIST_X = 40;
const LIST_W = 200;
const POINTER_X = LIST_X + LIST_W / 2;

function rect(top: number, height: number): ClientRect {
  return {
    top,
    height,
    left: LIST_X,
    width: LIST_W,
    bottom: top + height,
    right: LIST_X + LIST_W,
  };
}

function layerContainer(id: string): DroppableContainer {
  return { id, data: { current: { type: 'layer', layer: { id } } } } as DroppableContainer;
}

function pinContainer(id: string, layerId: string): DroppableContainer {
  return { id, data: { current: { type: 'pin', pin: { id, layerId } } } } as DroppableContainer;
}

function pin(id: string, layerId: string, position: number): Pin {
  return { id, layerId, position, lat: 0, lng: 0, label: id } as Pin;
}

function collisionRectAt(x: number, y: number): ClientRect {
  return { top: y, left: x, width: 1, height: 1, bottom: y + 1, right: x + 1 };
}

type Layout = {
  containers: DroppableContainer[];
  rects: Map<UniqueIdentifier, ClientRect>;
  pins: Pin[];
  layerOrder: string[];
};

function collideAt(
  layout: Layout,
  y: number,
  excludeIds: Set<string>,
  rects: Layout['rects'] = layout.rects
) {
  const args = {
    droppableContainers: layout.containers,
    droppableRects: rects,
    pointerCoordinates: { x: POINTER_X, y },
    collisionRect: collisionRectAt(POINTER_X, y),
  };
  const collisions = resolvePinDragCollision({
    pointerHits: pointerWithin(args as any),
    closestHits: closestCorners(args as any),
    droppableContainers: layout.containers,
    droppableRects: rects,
    pointerY: y,
    pins: layout.pins,
    layerOrder: layout.layerOrder,
    isCollapsed: () => false,
    excludeIds,
    activeId: 'dragged',
  });
  return collisions[0] ? String(collisions[0].id) : null;
}

/** Translate dest pins the way verticalListSortingStrategy would after `over`. */
function rectsAfterSortableShift(
  rects: Layout['rects'],
  itemIds: string[],
  activeId: string,
  overId: string,
  rowHeight: number
): Layout['rects'] {
  const shifted = pinsShiftedDown(itemIds, activeId, overId);
  if (shifted.length === 0) return rects;
  const next = new Map(rects);
  for (const id of shifted) {
    const current = next.get(id);
    if (!current) continue;
    next.set(id, {
      ...current,
      top: current.top + rowHeight,
      bottom: current.bottom + rowHeight,
    });
  }
  return next;
}

function dropDestOrder(
  pins: Pin[],
  overId: string,
  destLayerId: string
): string[] {
  const overIsLayer = overId === destLayerId;
  const next = reorderPins(
    pins,
    'dragged',
    overId,
    overIsLayer ? 'layer' : 'pin',
    destLayerId,
    new Set(),
    overIsLayer ? 'start' : 'end'
  );
  return next.filter((p) => p.layerId === destLayerId).map((p) => p.id);
}

/** Same parking handleDragOver does when a pin first enters another layer. */
function parkAtLayerEnd(pins: Pin[], activeId: string, destLayerId: string): Pin[] {
  const destPins = pins.filter((p) => p.id !== activeId && isSameLayer(p.layerId, destLayerId));
  const maxPos = destPins.length > 0 ? Math.max(...destPins.map((p) => p.position)) : -1;
  return pins.map((p) => (p.id === activeId ? { ...p, layerId: destLayerId, position: maxPos + 1 } : p));
}

function destLayerOf(overId: string, pins: Pin[]): string | undefined {
  if (overId === 'A' || overId === 'B' || overId === 'C' || overId === 'default') return overId;
  const overPin = pins.find((p) => p.id === overId);
  if (!overPin) return undefined;
  return overPin.layerId || 'default';
}

function shiftRectsFrom(rects: Layout['rects'], fromY: number, delta: number): Layout['rects'] {
  const next = new Map(rects);
  for (const [id, current] of next) {
    if (current.top >= fromY - 0.5) {
      next.set(id, {
        ...current,
        top: current.top + delta,
        bottom: current.bottom + delta,
      });
    }
  }
  return next;
}

function itemsInLayer(pins: Pin[], layerId: string | undefined): string[] {
  return pins
    .filter((p) => isSameLayer(p.layerId, layerId))
    .sort(comparePinPositions)
    .map((p) => p.id);
}

/** Park the dragged pin in destLayer and shift later layers as list height changes. */
function parkLayout(layout: Layout, destLayerId: string): Layout {
  const dragged = layout.pins.find((p) => p.id === 'dragged');
  const currentLayer = dragged?.layerId;
  if (currentLayer === destLayerId) return layout;

  const pins = parkAtLayerEnd(layout.pins, 'dragged', destLayerId);
  const fromIdx = layout.layerOrder.indexOf(String(currentLayer));
  const toIdx = layout.layerOrder.indexOf(destLayerId);
  let rects = new Map(layout.rects);
  if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx) {
    const nextKey = layout.layerOrder[toIdx + 1];
    const fromY = nextKey ? rects.get(nextKey)?.top : undefined;
    if (fromY != null) rects = shiftRectsFrom(rects, fromY, PIN_H);
  } else if (fromIdx >= 0 && toIdx > fromIdx) {
    const nextKey = layout.layerOrder[fromIdx + 1];
    const fromY = nextKey ? rects.get(nextKey)?.top : undefined;
    if (fromY != null) rects = shiftRectsFrom(rects, fromY, -PIN_H);
  }
  const destOthers = pins
    .filter((p) => p.id !== 'dragged' && isSameLayer(p.layerId, destLayerId))
    .sort(comparePinPositions);
  const lastRect = destOthers.length
    ? rects.get(destOthers[destOthers.length - 1].id)
    : rects.get(destLayerId);
  if (lastRect) {
    rects.set('dragged', rect(lastRect.bottom, PIN_H));
  }
  return { ...layout, pins, rects };
}

function wouldShiftPinsUp(itemIds: string[], activeId: string, overId: string): boolean {
  const activeIndex = itemIds.indexOf(activeId);
  const overIndex = itemIds.indexOf(overId);
  if (activeIndex === -1 || overIndex === -1) return false;
  return activeIndex < overIndex;
}

/** Pins Sortable would translate down, opening a gap at `over` (insert-before). */
function pinsShiftedDown(itemIds: string[], activeId: string, overId: string): string[] {
  const activeIndex = itemIds.indexOf(activeId);
  const overIndex = itemIds.indexOf(overId);
  if (activeIndex === -1 || overIndex === -1 || activeIndex <= overIndex) return [];
  return itemIds.slice(overIndex, activeIndex);
}

/** Last-slot preview: hole stays after the last real pin (parked row). */
function showsLastSlotPreview(itemIds: string[], activeId: string, overId: string): boolean {
  const activeIndex = itemIds.indexOf(activeId);
  if (activeIndex !== itemIds.length - 1) return false;
  if (overId === activeId) return true;
  const overIndex = itemIds.indexOf(overId);
  return overIndex === activeIndex;
}

function interior(rect: ClientRect): number[] {
  const ys: number[] = [];
  for (let y = Math.floor(rect.top) + 1; y <= Math.ceil(rect.bottom) - 1; y += 1) {
    ys.push(y);
  }
  return ys;
}

type SweepSlot = {
  name: string;
  over: string;
  destLayer: string;
  destOrder: string[];
  /** Dest-layer B pins that should shift down to open the blank. */
  bShift: string[];
};

describe('pin drag sweep through a layer', () => {
  const aHeader = rect(60, HEADER_H);
  const a1 = rect(aHeader.bottom, PIN_H);
  const a2 = rect(a1.bottom, PIN_H);
  const header = rect(a2.bottom, HEADER_H);
  const b1Top = header.bottom;
  const b2Top = b1Top + PIN_H;
  const b3Top = b2Top + PIN_H;
  const parkedTop = b3Top + PIN_H;
  const cHeader = rect(parkedTop + PIN_H, HEADER_H);
  const c1 = rect(cHeader.bottom, PIN_H);
  const headerMid = (header.top + header.bottom) / 2;
  const lastPinMid = b3Top + PIN_H / 2;
  const cHeaderMid = (cHeader.top + cHeader.bottom) / 2;

  const allPins: Pin[] = [
    pin('a1', 'A', 0),
    pin('a2', 'A', 1),
    pin('b1', 'B', 2),
    pin('b2', 'B', 3),
    pin('b3', 'B', 4),
    pin('dragged', 'B', 5),
    pin('c1', 'C', 6),
  ];
  const destPins = allPins.filter((p) => p.layerId === 'B');
  const sortableItems = destPins.map((p) => p.id);
  const excludeIds = new Set(['dragged']);

  const pinRects = [
    { id: 'b1', rect: rect(b1Top, PIN_H) },
    { id: 'b2', rect: rect(b2Top, PIN_H) },
    { id: 'b3', rect: rect(b3Top, PIN_H) },
  ];

  const layout: Layout = {
    containers: [
      layerContainer('A'),
      layerContainer('B'),
      layerContainer('C'),
      pinContainer('a1', 'A'),
      pinContainer('a2', 'A'),
      pinContainer('b1', 'B'),
      pinContainer('b2', 'B'),
      pinContainer('b3', 'B'),
      pinContainer('dragged', 'B'),
      pinContainer('c1', 'C'),
    ],
    rects: new Map<UniqueIdentifier, ClientRect>([
      ['A', aHeader],
      ['a1', a1],
      ['a2', a2],
      ['B', header],
      ['b1', pinRects[0].rect],
      ['b2', pinRects[1].rect],
      ['b3', pinRects[2].rect],
      ['dragged', rect(parkedTop, PIN_H)],
      ['C', cHeader],
      ['c1', c1],
    ]),
    pins: allPins,
    layerOrder: ['A', 'B', 'C'],
  };

  const fromA = [
    pin('a1', 'A', 0),
    pin('a2', 'A', 1),
    pin('dragged', 'A', 2),
    pin('b1', 'B', 3),
    pin('b2', 'B', 4),
    pin('b3', 'B', 5),
    pin('c1', 'C', 6),
  ];
  const parkedInB = parkAtLayerEnd(fromA, 'dragged', 'B').slice().sort(comparePinPositions);

  const lastOfA: SweepSlot = {
    name: 'last of previous (A)',
    over: 'a2',
    destLayer: 'A',
    destOrder: ['a1', 'a2', 'dragged'],
    bShift: [],
  };
  const firstOfB: SweepSlot = {
    name: 'first of B',
    over: 'b1',
    destLayer: 'B',
    destOrder: ['dragged', 'b1', 'b2', 'b3'],
    bShift: ['b1', 'b2', 'b3'],
  };
  const beforeB2: SweepSlot = {
    name: 'between b1 and b2',
    over: 'b2',
    destLayer: 'B',
    destOrder: ['b1', 'dragged', 'b2', 'b3'],
    bShift: ['b2', 'b3'],
  };
  const beforeLast: SweepSlot = {
    name: 'between next-to-last and last',
    over: 'b3',
    destLayer: 'B',
    destOrder: ['b1', 'b2', 'dragged', 'b3'],
    bShift: ['b3'],
  };
  const lastOfB: SweepSlot = {
    name: 'last of B',
    over: 'dragged',
    destLayer: 'B',
    destOrder: ['b1', 'b2', 'b3', 'dragged'],
    bShift: [],
  };
  const firstOfC: SweepSlot = {
    name: 'first of next (C)',
    over: 'c1',
    destLayer: 'C',
    destOrder: ['dragged', 'c1'],
    bShift: [],
  };

  /** Dragged pin is parked at the end of B (cross-layer dragOver). */
  function expectedSlot(y: number): SweepSlot {
    if (y < headerMid) return lastOfA;
    if (y <= pinRects[0].rect.bottom) return firstOfB;
    if (y <= pinRects[1].rect.bottom) return beforeB2;
    if (y < lastPinMid) return beforeLast;
    if (y < cHeaderMid) return lastOfB;
    return firstOfC;
  }

  const sweepStart = Math.floor(a2.top) + 1;
  const sweepEnd = c1.bottom;

  it('shows the correct blank into, through, and past a different layer at every pixel', () => {
    expect(parkedInB.find((p) => p.id === 'dragged')?.layerId).toBe('B');

    for (let y = sweepStart; y <= sweepEnd; y += 1) {
      const expected = expectedSlot(y);
      const overId = collideAt(layout, y, excludeIds);
      expect(overId, `y=${y} ${expected.name}`).toBe(expected.over);
      expect(
        pinsShiftedDown(sortableItems, 'dragged', overId!),
        `y=${y} ${expected.name} blank`
      ).toEqual(expected.bShift);
      expect(
        dropDestOrder(parkedInB, overId!, expected.destLayer),
        `y=${y} ${expected.name} drop`
      ).toEqual(expected.destOrder);
    }
  });

  it('is stable while sweeping back up through and out of the layer', () => {
    for (let y = sweepEnd; y >= sweepStart; y -= 1) {
      const expected = expectedSlot(y);
      const overId = collideAt(layout, y, excludeIds);
      expect(overId, `up y=${y} ${expected.name}`).toBe(expected.over);
      expect(
        pinsShiftedDown(sortableItems, 'dragged', overId!),
        `up y=${y} ${expected.name} blank`
      ).toEqual(expected.bShift);
      expect(
        dropDestOrder(parkedInB, overId!, expected.destLayer),
        `up y=${y} ${expected.name} drop`
      ).toEqual(expected.destOrder);

      const shiftedRects = rectsAfterSortableShift(
        layout.rects,
        sortableItems,
        'dragged',
        overId!,
        PIN_H
      );
      const overAfterShift = collideAt(layout, y, excludeIds, shiftedRects);
      expect(
        overAfterShift,
        `up y=${y} ${expected.name} oscillated ${overId} → ${overAfterShift} after sortable shift`
      ).toBe(overId);
    }
  });

  it('does not oscillate layer parking while sweeping back up past the layer', () => {
    // After a down-sweep past B, handleDragOver has parked the pin in C.
    let state = parkLayout(parkLayout({ ...layout, pins: fromA }, 'B'), 'C');
    expect(state.pins.find((p) => p.id === 'dragged')?.layerId).toBe('C');

    for (let y = sweepEnd; y >= sweepStart; y -= 1) {
      const overId = collideAt(state, y, excludeIds);
      expect(overId, `up-past y=${y}`).not.toBeNull();
      const destLayer = destLayerOf(overId!, state.pins);
      expect(destLayer, `up-past y=${y} over=${overId} has no dest layer`).toBeTruthy();

      const parkedLayer = state.pins.find((p) => p.id === 'dragged')?.layerId;
      if (destLayer && destLayer !== parkedLayer) {
        state = parkLayout(state, destLayer);
        const overAfterPark = collideAt(state, y, excludeIds);
        const destAfterPark = destLayerOf(overAfterPark!, state.pins);
        expect(
          destAfterPark,
          `up-past y=${y} parked in ${destLayer} then bounced to ${destAfterPark} (over ${overId} → ${overAfterPark})`
        ).toBe(destLayer);
      }

      const currentLayer = state.pins.find((p) => p.id === 'dragged')?.layerId;
      const overNow = collideAt(state, y, excludeIds)!;
      const shiftedRects = rectsAfterSortableShift(
        state.rects,
        itemsInLayer(state.pins, currentLayer),
        'dragged',
        overNow,
        PIN_H
      );
      const overAfterShift = collideAt(state, y, excludeIds, shiftedRects);
      const destAfterShift = destLayerOf(overAfterShift!, state.pins);
      if (destAfterShift && destAfterShift !== currentLayer) {
        const bounced = parkLayout(state, destAfterShift);
        const destAfterBounce = destLayerOf(collideAt(bounced, y, excludeIds)!, bounced.pins);
        expect(
          destAfterBounce,
          `up-past y=${y} parking cycle ${currentLayer} → ${destAfterShift} → ${destAfterBounce}`
        ).not.toBe(currentLayer);
      }
    }
  });

  it('does not oscillate when sweeping up past a layer whose header is sticky', () => {
    // Sticky B header sits at the top of the scrollport, overlapping A, while
    // B's pins stay in flow. This is what happens when you drag up past B.
    const stickyRects = new Map(layout.rects);
    stickyRects.set('B', rect(aHeader.top, HEADER_H));
    const stickyLayout = { ...layout, rects: stickyRects };

    for (let y = pinRects[0].rect.bottom; y >= sweepStart; y -= 1) {
      const overId = collideAt(stickyLayout, y, excludeIds);
      expect(overId, `sticky-up y=${y}`).not.toBeNull();

      if (y < a2.bottom && y > a2.top) {
        expect(
          overId,
          `sticky-up y=${y} on previous layer pin a2 must not be stolen by the layer we are leaving`
        ).toBe('a2');
      }

      const shiftedRects = rectsAfterSortableShift(
        stickyRects,
        sortableItems,
        'dragged',
        overId!,
        PIN_H
      );
      const overAfterShift = collideAt(stickyLayout, y, excludeIds, shiftedRects);
      expect(
        overAfterShift,
        `sticky-up y=${y} oscillated ${overId} → ${overAfterShift} after sortable shift`
      ).toBe(overId);
    }
  });

  it('never leaves the overlay sitting on an expanded header', () => {
    for (const y of interior(header)) {
      const overId = collideAt(layout, y, excludeIds);
      expect(overId, `y=${y} must not be the static header`).not.toBe('B');
    }
    for (const y of interior(cHeader)) {
      expect(collideAt(layout, y, excludeIds), `y=${y}`).not.toBe('C');
    }
  });

  it('shifts the header down (last of previous) or up (first of this) across the header', () => {
    for (const y of interior(header)) {
      if (y < headerMid) {
        expect(collideAt(layout, y, excludeIds)).toBe('a2');
      } else {
        expect(collideAt(layout, y, excludeIds)).toBe('b1');
      }
    }
  });

  it('picks the pin under the pointer at every pixel through the layer', () => {
    for (const y of interior(pinRects[0].rect)) {
      expect(collideAt(layout, y, excludeIds), `b1 y=${y}`).toBe('b1');
    }
    for (const y of interior(pinRects[1].rect)) {
      expect(collideAt(layout, y, excludeIds), `b2 y=${y}`).toBe('b2');
    }
    const lastPin = pinRects[2].rect;
    for (const y of interior(lastPin).filter((y) => y < lastPinMid)) {
      expect(collideAt(layout, y, excludeIds), `last pin top y=${y}`).toBe('b3');
    }
    for (const y of interior(lastPin).filter((y) => y >= lastPinMid)) {
      expect(collideAt(layout, y, excludeIds), `last pin bottom y=${y}`).toBe('dragged');
    }
    for (const y of interior(rect(parkedTop, PIN_H))) {
      expect(collideAt(layout, y, excludeIds), `parked row y=${y}`).toBe('dragged');
    }
  });

  it('shows a blank between the next-to-last and last pins when dragging from another layer', () => {
    const lastPin = pinRects[2].rect;
    const topHalf = interior(lastPin).filter((y) => y < lastPinMid);
    expect(topHalf.length).toBeGreaterThan(0);

    for (const y of topHalf) {
      const overId = collideAt(layout, y, excludeIds)!;
      expect(
        pinsShiftedDown(sortableItems, 'dragged', overId),
        `y=${y} over=${overId} should open a blank before the last pin`
      ).toEqual(['b3']);
      expect(dropDestOrder(parkedInB, overId, 'B'), `y=${y} second-to-last`).toEqual([
        'b1', 'b2', 'dragged', 'b3',
      ]);
    }
  });

  it('shows the blank after the last pin when targeting the last position', () => {
    const lastOther = 'b3';
    const lastPin = pinRects[2].rect;
    const lastSlotYs = interior(lastPin).filter((y) => y >= lastPinMid);
    expect(lastSlotYs.length).toBeGreaterThan(0);

    for (const y of lastSlotYs) {
      const overId = collideAt(layout, y, excludeIds)!;
      expect(
        pinsShiftedDown(sortableItems, 'dragged', overId),
        `y=${y} over=${overId} opens a blank before the last pin`
      ).not.toContain(lastOther);
      expect(
        showsLastSlotPreview(sortableItems, 'dragged', overId),
        `y=${y} over=${overId} should preview last slot`
      ).toBe(true);
      expect(dropDestOrder(parkedInB, overId, 'B').at(-1), `y=${y}`).toBe('dragged');
    }
  });

  it('never shifts destination pins upward while parked at the end', () => {
    for (let y = b1Top + 1; y < cHeader.top; y += 1) {
      const overId = collideAt(layout, y, excludeIds)!;
      expect(
        wouldShiftPinsUp(sortableItems, 'dragged', overId),
        `y=${y} over=${overId} would shift dest pins up`
      ).toBe(false);
    }
  });
});

describe('pin drag sweep across a layer boundary', () => {
  it('splits the next header into last-of-previous then first-of-this', () => {
    const aLastTop = 80;
    const bHeaderTop = aLastTop + PIN_H;
    const bHeader = rect(bHeaderTop, HEADER_H);
    const layout: Layout = {
      containers: [
        layerContainer('A'),
        layerContainer('B'),
        pinContainer('a2', 'A'),
        pinContainer('b1', 'B'),
      ],
      rects: new Map<UniqueIdentifier, ClientRect>([
        ['A', rect(0, HEADER_H)],
        ['a2', rect(aLastTop, PIN_H)],
        ['B', bHeader],
        ['b1', rect(bHeaderTop + HEADER_H, PIN_H)],
      ]),
      pins: [pin('a2', 'A', 0), pin('b1', 'B', 1)],
      layerOrder: ['A', 'B'],
    };

    const excludeIds = new Set(['dragged']);
    const overs: string[] = [];
    for (let y = aLastTop; y <= bHeaderTop + HEADER_H; y += 1) {
      const overId = collideAt(layout, y, excludeIds);
      expect(overId, `y=${y} must not sit on the header`).not.toBe('B');
      overs.push(overId!);
    }

    const compact = overs.filter((id, i) => i === 0 || id !== overs[i - 1]);
    expect(compact).toEqual(['a2', 'b1']);

    const headerMid = (bHeader.top + bHeader.bottom) / 2;
    for (const y of interior(bHeader)) {
      if (y < headerMid) {
        expect(collideAt(layout, y, excludeIds), `header top y=${y}`).toBe('a2');
      } else {
        expect(collideAt(layout, y, excludeIds), `header bottom y=${y}`).toBe('b1');
      }
    }
  });
});

describe('drag a pin up from the default layer', () => {
  const bHeader = rect(80, HEADER_H);
  const b1 = rect(bHeader.bottom, PIN_H);
  const b2 = rect(b1.bottom, PIN_H);
  const b3 = rect(b2.bottom, PIN_H);
  const defaultHeader = rect(b3.bottom, HEADER_H);
  const d1 = rect(defaultHeader.bottom, PIN_H);
  const draggedRect = rect(d1.bottom, PIN_H);
  const defaultHeaderMid = (defaultHeader.top + defaultHeader.bottom) / 2;
  const lastPinMid = b3.top + PIN_H / 2;

  const basePins: Pin[] = [
    pin('b1', 'B', 0),
    pin('b2', 'B', 1),
    pin('b3', 'B', 2),
    pin('d1', undefined as unknown as string, 3),
    pin('dragged', undefined as unknown as string, 4),
  ];
  const excludeIds = new Set(['dragged']);
  const layout: Layout = {
    containers: [
      layerContainer('B'),
      layerContainer('default'),
      pinContainer('b1', 'B'),
      pinContainer('b2', 'B'),
      pinContainer('b3', 'B'),
      pinContainer('d1', undefined as unknown as string),
      pinContainer('dragged', undefined as unknown as string),
    ],
    rects: new Map<UniqueIdentifier, ClientRect>([
      ['B', bHeader],
      ['b1', b1],
      ['b2', b2],
      ['b3', b3],
      ['default', defaultHeader],
      ['d1', d1],
      ['dragged', draggedRect],
    ]),
    pins: basePins,
    layerOrder: ['B', 'default'],
  };

  function collideParked(y: number, destLayerId: string | undefined) {
    const pins = applyDragPark(basePins, { destLayerId, pinIds: ['dragged'] });
    return {
      overId: collideAt({ ...layout, pins }, y, excludeIds),
      pins,
    };
  }

  it('does not oscillate while dragging a default-layer pin up into a named layer', () => {
    let destLayerId: string | undefined;
    const sweepStart = Math.floor(draggedRect.top) + 1;
    const sweepEnd = bHeader.top;

    for (let y = sweepStart; y >= sweepEnd; y -= 1) {
      const { overId, pins } = collideParked(y, destLayerId);
      expect(overId, `default-up y=${y}`).not.toBeNull();

      if (y > d1.top && y < d1.bottom) {
        expect(
          overId,
          `default-up y=${y} on default pin d1 must not be treated as last-slot of default or of the named layer`
        ).toBe('d1');
      }

      const dest = destLayerOf(overId!, pins);
      expect(dest, `default-up y=${y} over=${overId}`).toBeTruthy();
      const nextDest = dest === 'default' ? undefined : dest;
      const afterPark = collideParked(y, nextDest);
      expect(
        destLayerOf(afterPark.overId!, afterPark.pins),
        `default-up y=${y} parked in ${String(nextDest)} then bounced (over ${overId} → ${afterPark.overId})`
      ).toBe(dest);

      const items = itemsInLayer(afterPark.pins, nextDest);
      const shiftedRects = rectsAfterSortableShift(
        layout.rects,
        items,
        'dragged',
        afterPark.overId!,
        PIN_H
      );
      const overAfterShift = collideAt(
        { ...layout, pins: afterPark.pins },
        y,
        excludeIds,
        shiftedRects
      );
      expect(
        overAfterShift,
        `default-up y=${y} oscillated ${afterPark.overId} → ${overAfterShift} after sortable shift`
      ).toBe(afterPark.overId);

      destLayerId = nextDest;
    }
  });

  it('maps default header to last of the named layer then first of default', () => {
    for (const y of interior(defaultHeader)) {
      const { overId } = collideParked(y, 'B');
      if (y < defaultHeaderMid) {
        expect(overId, `default header top y=${y} last of B`).toBe('dragged');
      } else {
        expect(overId, `default header bottom y=${y} first of default`).toBe('d1');
      }
    }
  });

  it('keeps last-pin top half as insert-before-last when coming up from default', () => {
    const { overId } = collideParked(lastPinMid - 1, 'B');
    expect(overId).toBe('b3');
    expect(pinsShiftedDown(['b1', 'b2', 'b3', 'dragged'], 'dragged', overId!)).toEqual(['b3']);
  });
});

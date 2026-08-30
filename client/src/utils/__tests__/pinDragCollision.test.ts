import { describe, it, expect } from 'vitest';
import type { Collision, DroppableContainer } from '@dnd-kit/core';
import { resolvePinDragCollision } from '../pinDragCollision';

function layerContainer(id: string): DroppableContainer {
  return { id, data: { current: { type: 'layer', layer: { id } } } } as DroppableContainer;
}

function pinContainer(id: string, layerId?: string): DroppableContainer {
  return { id, data: { current: { type: 'pin', pin: { id, layerId } } } } as DroppableContainer;
}

function hit(id: string): Collision {
  return { id };
}

describe('resolvePinDragCollision', () => {
  const containers = [
    layerContainer('L1'),
    layerContainer('L2'),
    layerContainer('default'),
    pinContainer('p1', 'L1'),
    pinContainer('p2', 'L1'),
    pinContainer('p3', 'L2'),
    pinContainer('p4', 'L2'),
    pinContainer('p5'),
    pinContainer('dragged', 'L2'),
  ];
  const excludeIds = new Set<string>(['dragged']);

  const resolve = (
    overrides: Partial<Parameters<typeof resolvePinDragCollision>[0]>
  ) =>
    resolvePinDragCollision({
      pointerHits: [],
      closestHits: [hit('p3')],
      droppableContainers: containers,
      excludeIds,
      ...overrides,
    });

  it('uses a pin under the pointer even when the parent layer is also hit', () => {
    const result = resolve({
      pointerHits: [hit('L2'), hit('p3')],
    });
    expect(result.map((c) => c.id)).toEqual(['p3']);
  });

  it('ignores the dragged pin so a header under the pointer stays a header', () => {
    const result = resolve({
      pointerHits: [hit('L2'), hit('dragged')],
    });
    expect(result.map((c) => c.id)).toEqual(['L2']);
  });

  it('keeps a layer header as the drop target when no pin is hit', () => {
    const result = resolve({
      pointerHits: [hit('L2')],
    });
    expect(result.map((c) => c.id)).toEqual(['L2']);
  });

  it('uses the last pin under the pointer as the last-slot target', () => {
    const result = resolve({
      pointerHits: [hit('p4')],
    });
    expect(result.map((c) => c.id)).toEqual(['p4']);
  });

  it('falls back to closestCorners when the pointer is not over a pin or header', () => {
    const closestHits = [hit('p4')];
    const result = resolve({
      pointerHits: [],
      closestHits,
    });
    expect(result).toEqual(closestHits);
  });

  it('ignores the dragged pin in closestCorners when another target exists', () => {
    const result = resolve({
      pointerHits: [],
      closestHits: [hit('dragged'), hit('p4')],
    });
    expect(result.map((c) => c.id)).toEqual(['p4']);
  });
});

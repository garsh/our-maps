/** Remove `movedIds` from `orderedIds` and insert them as a block at `insertIndex` among the remaining ids. */
export function insertIdsAt(
  orderedIds: string[],
  movedIds: string[],
  insertIndex: number
): string[] {
  if (!movedIds.length) return orderedIds.slice();
  const movedSet = new Set(movedIds);
  const remaining = orderedIds.filter((id) => !movedSet.has(id));
  const raw = Number(insertIndex);
  const insertAt = Number.isFinite(raw)
    ? Math.max(0, Math.min(Math.floor(raw), remaining.length))
    : remaining.length;
  return [...remaining.slice(0, insertAt), ...movedIds, ...remaining.slice(insertAt)];
}

/**
 * Index among remaining (unmoved) ids where the moved block sits after the local reorder.
 * Equal to remaining.length when the block is at the end.
 */
export function insertIndexAfterMove(orderedIds: string[], movedIds: string[]): number {
  if (!movedIds.length) return orderedIds.length;
  const movedSet = new Set(movedIds);
  let i = 0;
  while (i < orderedIds.length && !movedSet.has(orderedIds[i])) i += 1;
  return i;
}

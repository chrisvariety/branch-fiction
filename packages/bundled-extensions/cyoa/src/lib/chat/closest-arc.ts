type ChapterRange = { start?: number | null; end?: number | null };

type ArcLike = {
  id: string;
  startChapterIdx?: number | null;
  endChapterIdx?: number | null;
  bookEntities?: { id: string }[];
};

export const findClosestArcForEntity = <A extends ArcLike>(
  entityId: string,
  characterArcChapterRange: ChapterRange,
  arcs: readonly A[]
): string | null => {
  const entityArcs = arcs.filter((arc) => {
    const entities = arc.bookEntities || [];
    return entities.some((e) => e.id === entityId);
  });

  const cStart = characterArcChapterRange.start;
  const cEnd = characterArcChapterRange.end;
  if (entityArcs.length === 0) return null;

  const getArcSortChapter = (arc: ArcLike) =>
    arc.startChapterIdx ?? arc.endChapterIdx ?? Number.NEGATIVE_INFINITY;

  // If we don't have a target chapter range, pick the latest arc we know about.
  if (cStart == null || cEnd == null) {
    let latest = entityArcs[0];
    for (const arc of entityArcs.slice(1)) {
      if (getArcSortChapter(arc) > getArcSortChapter(latest)) latest = arc;
    }
    return latest.id;
  }

  let bestArc: ArcLike | null = null;
  let bestOverlap = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  const calculateRangeDistance = (a: { start: number; end: number }, b: ArcLike) => {
    const bStart = b.startChapterIdx;
    const bEnd = b.endChapterIdx;
    if (bStart == null || bEnd == null) return Number.POSITIVE_INFINITY;
    if (bEnd < a.start) return a.start - bEnd;
    if (bStart > a.end) return bStart - a.end;
    return 0;
  };

  for (const candidateArc of entityArcs) {
    const aStart = candidateArc.startChapterIdx;
    const aEnd = candidateArc.endChapterIdx;
    const overlap =
      aStart == null || aEnd == null
        ? 0
        : calculateInclusiveChapterOverlap(
            { start: cStart, end: cEnd },
            { start: aStart, end: aEnd }
          );
    const distance = calculateRangeDistance({ start: cStart, end: cEnd }, candidateArc);

    if (
      bestArc == null ||
      overlap > bestOverlap ||
      (overlap === bestOverlap && distance < bestDistance) ||
      (overlap === bestOverlap &&
        distance === bestDistance &&
        getArcSortChapter(candidateArc) > getArcSortChapter(bestArc))
    ) {
      bestOverlap = overlap;
      bestDistance = distance;
      bestArc = candidateArc;
    }
  }

  return bestArc ? bestArc.id : null;
};

/**
 * Finds the closest appellation arc for each target entity where the given source entity
 * refers to a target in the provided set. Uses findClosestArcForEntity for chapter range selection.
 */
export const findClosestAppellationsForSourceEntity = <
  A extends ArcLike & { bookEntityIds: string[] }
>(
  sourceEntityId: string,
  targetEntityIds: Set<string>,
  chapterRange: ChapterRange,
  appellationArcs: readonly A[]
): string[] => {
  // Pre-filter to arcs where this entity is the source
  const sourceArcs = appellationArcs.filter(
    (arc) => arc.bookEntityIds[0] === sourceEntityId
  );

  // For each valid target, find the closest arc using the same logic as appearances
  const result: string[] = [];
  for (const targetId of targetEntityIds) {
    if (targetId === sourceEntityId) continue;

    const closestArcId = findClosestArcForEntity(targetId, chapterRange, sourceArcs);
    if (closestArcId) {
      result.push(closestArcId);
    }
  }

  return result;
};

const calculateInclusiveChapterOverlap = (
  a: { start: number; end: number },
  b: { start: number; end: number }
) => {
  if (!Number.isFinite(a.start) || !Number.isFinite(a.end)) return 0;
  if (!Number.isFinite(b.start) || !Number.isFinite(b.end)) return 0;
  if (a.start > a.end || b.start > b.end) return 0;

  const intersectionStart = Math.max(a.start, b.start);
  const intersectionEnd = Math.min(a.end, b.end);
  return Math.max(0, intersectionEnd - intersectionStart + 1);
};

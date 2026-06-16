import type { Book, BookEntityHierarchy } from '@branch-fiction/extension-sdk/db';

import { getChapterEntityAttributesByBookEntityIdsAndCategories } from '@/worker/db/models/chapter-entity-attribute/get-chapter-entity-attribute';

import type { EntityHierarchyNode } from './hierarchy';
import { BaseEntity, Relationship } from './relationship-graph';

const MIN_PRIMARY_HUBS = 5;

export type AnchorScore = {
  anchorId: string;
  anchorName: string;
  totalVolume: number;
  chaptersWon: number;
  winningChapters: number[];
  isEra: boolean;
};

export type HubScore = {
  hubId: string;
  hubName: string;
  totalVolume: number;
  chaptersWon: number;
  winningChapters: number[];
  isEra: boolean;
  isPromoted: boolean;
  promotionReason: 'FINALE' | 'CHAPTER_WINNER_WITH_ATTRIBUTES' | null;
};

// Era Detector: finds places that monopolize the narrative for 2+ chapters (>40% chapter share).
export function getPrimaryAnchors<T extends BaseEntity>(
  relationships: Relationship<T>[],
  hierarchies: Array<{
    bookEntityId: string;
    level: BookEntityHierarchy['level'];
    parentBookEntityId: string | null;
  }>,
  entityIdToName: Map<string, string>,
  targetLevel: 'HUB' | 'LOCALE'
): AnchorScore[] {
  const entityToAnchor = buildEntityToAnchorMap(hierarchies, targetLevel);

  // Get anchor names for display
  const anchorIdToName = new Map<string, string>();
  for (const record of hierarchies) {
    if (record.level === targetLevel) {
      anchorIdToName.set(
        record.bookEntityId,
        entityIdToName.get(record.bookEntityId) ?? 'Unknown'
      );
    }
  }

  // Bucket interactions by chapter: chapterIdx -> { anchorId -> count }
  const chapterStats = new Map<number, Map<string, number>>();

  for (const rel of relationships) {
    const chapterIdx = rel.chapter.idx;
    const sourceAnchorId = entityToAnchor.get(rel.sourceEntity.id);
    const targetAnchorId = entityToAnchor.get(rel.targetEntity.id);

    if (!chapterStats.has(chapterIdx)) {
      chapterStats.set(chapterIdx, new Map());
    }
    const chapterCounts = chapterStats.get(chapterIdx)!;

    if (sourceAnchorId) {
      chapterCounts.set(sourceAnchorId, (chapterCounts.get(sourceAnchorId) ?? 0) + 1);
    }
    if (targetAnchorId) {
      chapterCounts.set(targetAnchorId, (chapterCounts.get(targetAnchorId) ?? 0) + 1);
    }
  }

  // Initialize all anchors with zero scores
  const anchorScores = new Map<string, AnchorScore>();
  for (const [anchorId, anchorName] of anchorIdToName) {
    anchorScores.set(anchorId, {
      anchorId,
      anchorName,
      totalVolume: 0,
      chaptersWon: 0,
      winningChapters: [],
      isEra: false
    });
  }

  // Process each chapter to find winners
  for (const [chapterIdx, counts] of chapterStats) {
    let totalInChapter = 0;
    for (const count of counts.values()) {
      totalInChapter += count;
    }
    if (totalInChapter === 0) continue;

    let winnerId = '';
    let maxCount = 0;

    for (const [anchorId, count] of counts) {
      // Accumulate total volume
      const score = anchorScores.get(anchorId);
      if (score) {
        score.totalVolume += count;
      }

      if (count > maxCount) {
        maxCount = count;
        winnerId = anchorId;
      }
    }

    // To "win" a chapter, must have >40% of the action
    if (winnerId && maxCount / totalInChapter > 0.4) {
      const score = anchorScores.get(winnerId);
      if (score) {
        score.chaptersWon++;
        score.winningChapters.push(chapterIdx);
      }
    }
  }

  // Mark ERAs and sort
  return Array.from(anchorScores.values())
    .map((anchor) => {
      if (anchor.chaptersWon >= 2) {
        anchor.isEra = true;
      }
      return anchor;
    })
    .filter((anchor) => anchor.totalVolume > 0)
    .sort((a, b) => {
      if (a.isEra && !b.isEra) return -1;
      if (!a.isEra && b.isEra) return 1;
      if (b.chaptersWon !== a.chaptersWon) return b.chaptersWon - a.chaptersWon;
      return b.totalVolume - a.totalVolume;
    });
}

/**
 * Build a map of anchor -> territory (all entity IDs in the anchor's subtree with their levels)
 * Works at either HUB or LOCALE level depending on anchorLevel parameter
 */
export function buildHubTerritoryMap(
  hierarchyRecords: EntityHierarchyNode[],
  anchorLevel: 'HUB' | 'LOCALE' = 'HUB'
): Map<string, Map<string, EntityHierarchyNode['level']>> {
  const territories = new Map<string, Map<string, EntityHierarchyNode['level']>>();

  // First, identify all anchors at the target level and initialize their territories
  for (const record of hierarchyRecords) {
    if (record.level === anchorLevel) {
      const territory = new Map<string, EntityHierarchyNode['level']>();
      territory.set(record.bookEntityId, anchorLevel);
      territories.set(record.bookEntityId, territory);
    }
  }

  // Build entity -> anchor mapping (to find which anchor each entity belongs to)
  const entityToAnchor = buildEntityToAnchorMap(hierarchyRecords, anchorLevel);

  // Add all child entities to their anchor's territory
  for (const record of hierarchyRecords) {
    if (record.level === anchorLevel) continue;

    const anchorId = entityToAnchor.get(record.bookEntityId);
    if (anchorId && territories.has(anchorId)) {
      territories.get(anchorId)!.set(record.bookEntityId, record.level);
    }
  }

  return territories;
}

/**
 * Build a map from each HUB to all its descendant entity IDs.
 * This allows us to check attributes on the HUB and all its children.
 */
function buildHubToDescendantsMap(
  hierarchyRecords: EntityHierarchyNode[]
): Map<string, string[]> {
  const hubToDescendants = new Map<string, string[]>();
  const parentMap = new Map<string, string | null>();

  // Build parent lookup
  for (const record of hierarchyRecords) {
    parentMap.set(record.bookEntityId, record.parentBookEntityId);
  }

  // Initialize HUBs with themselves
  for (const record of hierarchyRecords) {
    if (record.level === 'HUB') {
      hubToDescendants.set(record.bookEntityId, [record.bookEntityId]);
    }
  }

  // For each non-HUB entity, find its ancestor HUB and add to descendants
  for (const record of hierarchyRecords) {
    if (record.level === 'HUB') continue;

    // Walk up to find the HUB
    let currentId: string | null = record.bookEntityId;
    let hubId: string | null = null;

    while (currentId !== null) {
      const parent = parentMap.get(currentId);
      if (parent === null || parent === undefined) {
        // Check if current is a HUB
        const currentRecord = hierarchyRecords.find((r) => r.bookEntityId === currentId);
        if (currentRecord?.level === 'HUB') {
          hubId = currentId;
        }
        break;
      }
      const parentRecord = hierarchyRecords.find((r) => r.bookEntityId === parent);
      if (parentRecord?.level === 'HUB') {
        hubId = parent;
        break;
      }
      currentId = parent;
    }

    if (hubId && hubToDescendants.has(hubId)) {
      hubToDescendants.get(hubId)!.push(record.bookEntityId);
    }
  }

  return hubToDescendants;
}

/**
 * Check if a hub or any of its descendants has PHYSICAL or MAGICAL attributes.
 */
async function hubOrDescendantsHaveAttributes(
  hubId: string,
  hubToDescendants: Map<string, string[]>
): Promise<boolean> {
  const entityIds = hubToDescendants.get(hubId) ?? [hubId];

  const attributes = await getChapterEntityAttributesByBookEntityIdsAndCategories(
    entityIds,
    ['PHYSICAL', 'MAGICAL']
  );
  return attributes.length > 0;
}

// Promotes non-Era hubs (finale winner first, then by chaptersWon) until MIN_PRIMARY_HUBS is reached.
export async function promoteHubsWithAttributes<T extends BaseEntity>(
  hubs: HubScore[],
  hierarchyRecords: EntityHierarchyNode[],
  relationships: Relationship<T>[]
): Promise<HubScore[]> {
  const eraCount = hubs.filter((h) => h.isEra).length;

  if (eraCount >= MIN_PRIMARY_HUBS) {
    // Already have enough, no promotion needed
    return hubs;
  }

  const needed = MIN_PRIMARY_HUBS - eraCount;

  // Get candidates: non-Era hubs that won at least 1 chapter
  const candidates = hubs.filter((h) => !h.isEra && h.chaptersWon >= 1);

  if (candidates.length === 0) {
    // No candidates to promote
    return hubs;
  }

  // Build the hub-to-descendants map for attribute checking
  const hubToDescendants = buildHubToDescendantsMap(hierarchyRecords);

  // Find the actual last chapter of the book from relationships
  const maxBookChapter = Math.max(...relationships.map((r) => r.chapter.idx));

  // A "finale" is a non-Era hub that won the LAST chapter of the book
  const finaleCandidate = candidates.find((h) =>
    h.winningChapters.includes(maxBookChapter)
  );

  // Track promoted hubs
  const promotedIds = new Set<string>();
  let promotedCount = 0;

  // Step 1: Check finale candidate first (if one exists)
  if (finaleCandidate) {
    const finaleHasAttrs = await hubOrDescendantsHaveAttributes(
      finaleCandidate.hubId,
      hubToDescendants
    );
    if (finaleHasAttrs) {
      finaleCandidate.isPromoted = true;
      finaleCandidate.promotionReason = 'FINALE';
      promotedIds.add(finaleCandidate.hubId);
      promotedCount++;
    }
  }

  // Step 2: Check remaining candidates by chaptersWon
  if (promotedCount < needed) {
    // Sort remaining candidates by chaptersWon (excluding finale if it was promoted)
    const remainingCandidates = candidates
      .filter((h) => !promotedIds.has(h.hubId))
      .sort((a, b) => {
        // Sort by chapters won descending, then volume
        if (b.chaptersWon !== a.chaptersWon) {
          return b.chaptersWon - a.chaptersWon;
        }
        return b.totalVolume - a.totalVolume;
      });

    for (const candidate of remainingCandidates) {
      if (promotedCount >= needed) break;

      const hasAttrs = await hubOrDescendantsHaveAttributes(
        candidate.hubId,
        hubToDescendants
      );

      if (hasAttrs) {
        candidate.isPromoted = true;
        candidate.promotionReason = 'CHAPTER_WINNER_WITH_ATTRIBUTES';
        promotedIds.add(candidate.hubId);
        promotedCount++;
      }
    }
  }

  // Re-sort: ERAs first, then promoted, then others
  return hubs.sort((a, b) => {
    // ERAs first
    if (a.isEra && !b.isEra) return -1;
    if (!a.isEra && b.isEra) return 1;

    // If both are ERAs, sort by chapters won
    if (a.isEra && b.isEra) {
      if (b.chaptersWon !== a.chaptersWon) return b.chaptersWon - a.chaptersWon;
      return b.totalVolume - a.totalVolume;
    }

    // Promoted next
    if (a.isPromoted && !b.isPromoted) return -1;
    if (!a.isPromoted && b.isPromoted) return 1;

    // If both promoted, sort by reason (FINALE first) then chapters won
    if (a.isPromoted && b.isPromoted) {
      if (a.promotionReason === 'FINALE' && b.promotionReason !== 'FINALE') return -1;
      if (a.promotionReason !== 'FINALE' && b.promotionReason === 'FINALE') return 1;
      if (b.chaptersWon !== a.chaptersWon) return b.chaptersWon - a.chaptersWon;
      return b.totalVolume - a.totalVolume;
    }

    // Neither ERA nor promoted: by chapters won then volume
    if (b.chaptersWon !== a.chaptersWon) return b.chaptersWon - a.chaptersWon;
    return b.totalVolume - a.totalVolume;
  });
}

// ENSEMBLE if top hub wins >60% of chapters or only 1 ERA exists; otherwise EPISODIC.

const DOMINANCE_THRESHOLD = 0.6; // 60% chapter dominance = ENSEMBLE

export function classifyBookType(
  primaryHubs: HubScore[],
  totalChapters: number
): {
  bookType: Book['characterRankType'];
  dominanceRatio: number;
  topHub: HubScore | undefined;
  reason: string;
} {
  if (primaryHubs.length === 0) {
    return {
      bookType: 'ENSEMBLE',
      dominanceRatio: 0,
      topHub: undefined,
      reason: 'No primary hubs detected - defaulting to ENSEMBLE'
    };
  }

  const topHub = primaryHubs[0];
  const dominanceRatio = topHub.chaptersWon / totalChapters;

  // Count actual ERAs (not promoted)
  const eraCount = primaryHubs.filter((h) => h.isEra).length;

  // Rule 1: If only 1 ERA exists, it's ENSEMBLE (single base camp)
  if (eraCount <= 1) {
    return {
      bookType: 'ENSEMBLE',
      dominanceRatio,
      topHub,
      reason: `Only ${eraCount} ERA detected - single base camp, no journey`
    };
  }

  // Rule 2: If top hub dominates >60% of chapters, it's ENSEMBLE
  if (dominanceRatio > DOMINANCE_THRESHOLD) {
    return {
      bookType: 'ENSEMBLE',
      dominanceRatio,
      topHub,
      reason: `Top hub dominates ${(dominanceRatio * 100).toFixed(1)}% of chapters`
    };
  }

  // Otherwise: EPISODIC (multiple significant locations)
  return {
    bookType: 'EPISODIC',
    dominanceRatio,
    topHub,
    reason: `${eraCount} ERAs with no single dominant hub`
  };
}

/**
 * Build a map from any entity ID to its "anchor" ID at the specified level.
 * - If level = 'HUB': HUBs map to themselves, LOCALEs/MICROs map to their ancestor HUB
 * - If level = 'LOCALE': LOCALEs map to themselves, MICROs map to their parent LOCALE
 */
function buildEntityToAnchorMap(
  hierarchies: Array<{
    bookEntityId: string;
    level: BookEntityHierarchy['level'];
    parentBookEntityId: string | null;
  }>,
  targetLevel: 'HUB' | 'LOCALE'
): Map<string, string> {
  const entityToAnchor = new Map<string, string>();
  const parentMap = new Map<string, string | null>();
  const levelMap = new Map<string, BookEntityHierarchy['level']>();

  // First pass: build parent and level lookups
  for (const record of hierarchies) {
    parentMap.set(record.bookEntityId, record.parentBookEntityId);
    levelMap.set(record.bookEntityId, record.level);

    // Target level entities map to themselves
    if (record.level === targetLevel) {
      entityToAnchor.set(record.bookEntityId, record.bookEntityId);
    }
  }

  // Second pass: for non-target-level entities, traverse up to find their anchor
  for (const record of hierarchies) {
    if (record.level === targetLevel) continue;

    let currentId: string | null = record.bookEntityId;
    let anchorId: string | null = null;

    // Walk up the hierarchy to find the anchor at target level
    while (currentId !== null) {
      const level = levelMap.get(currentId);
      if (level === targetLevel) {
        anchorId = currentId;
        break;
      }
      currentId = parentMap.get(currentId) ?? null;
    }

    if (anchorId) {
      entityToAnchor.set(record.bookEntityId, anchorId);
    }
  }

  return entityToAnchor;
}

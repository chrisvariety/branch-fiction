import Graph from 'graphology';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness.js';
import pagerank from 'graphology-metrics/centrality/pagerank.js';

import { Book } from '@/app/lib/db/types';

import {
  calculateChapterSpans,
  extractMetricsFromGraph,
  normalizeScores
} from './entity-significance';
import { entityThresholds } from './entity-significance-estimate';
import { EntityHierarchyNode } from './hierarchy';
import { HubScore } from './place-significance';
import {
  BaseEntity,
  buildRelationshipGraph,
  findAnchorCharacterIds,
  Relationship
} from './relationship-graph';

const MAX_PRIMARY_CHARACTERS = 10;

// Depth weights for attachment scoring
const DEPTH_WEIGHTS: Record<EntityHierarchyNode['level'], number> = {
  REALM: 0, // REALMs shouldn't count
  HUB: 1,
  LOCALE: 3,
  MICRO: 5
};

type LocalCharacterScore = {
  characterId: string;
  characterName: string;
  score: number;
  breakdown: {
    attachment: number;
    density: number;
  };
  // Debug info
  placeInteractions: number;
  socialInteractionsInTerritory: number;
};

// Global character ranking result
type GlobalCharacterRanking = {
  characterId: string;
  characterName: string;
  globalScore: number;
  tier: 'PRIMARY' | 'SECONDARY';
  // Debug: contribution from each hub/place
  hubContributions: Array<{
    hubId?: string; // entity ID (for database storage)
    hubName: string;
    localScore: number;
    marketShare: number;
    duration: number;
    contribution: number;
  }>;
};

export function getTopCharacters<T extends BaseEntity>(
  bookType: Book['characterRankType'],
  primaryHubs: HubScore[],
  hubTerritories: Map<string, Map<string, EntityHierarchyNode['level']>>,
  relationships: Relationship<T>[],
  hierarchyRecords: EntityHierarchyNode[]
): GlobalCharacterRanking[] {
  const rankings =
    bookType === 'ENSEMBLE'
      ? runEnsembleStrategy(relationships, hierarchyRecords)
      : runEpisodicStrategy(primaryHubs, hubTerritories, relationships);

  // Promote anchor characters (highest relationship degree) from SECONDARY to PRIMARY
  const graph = buildRelationshipGraph(relationships);
  const anchorIds = findAnchorCharacterIds(graph);
  const throughoutCharacters = getThroughoutCharacters(relationships);
  const primaryCount = rankings.filter((r) => r.tier === 'PRIMARY').length;
  let promoted = 0;

  for (const ranking of rankings) {
    if (
      ranking.tier === 'SECONDARY' &&
      anchorIds.has(ranking.characterId) &&
      !throughoutCharacters.has(ranking.characterId) &&
      primaryCount + promoted < MAX_PRIMARY_CHARACTERS
    ) {
      console.log(
        `[ANCHOR PROMOTE] Promoting "${ranking.characterName}" from SECONDARY to PRIMARY: anchor character (high relationship degree)`
      );
      ranking.tier = 'PRIMARY';
      promoted++;
    }
  }

  return rankings;
}

function getStructuralLocalCast<T extends BaseEntity>(
  territory: Map<string, EntityHierarchyNode['level']>, // entityId -> level
  relationships: Relationship<T>[],
  topN: number = 8
): LocalCharacterScore[] {
  const entityIdToName = buildEntityIdToName(relationships);

  type PlaceEdge = {
    characterId: string;
    placeId: string;
    placeLevel: EntityHierarchyNode['level'];
    chapterIdx: number;
  };

  type SocialEdge = {
    char1Id: string;
    char2Id: string;
    chapterIdx: number;
  };

  const placeEdges: PlaceEdge[] = [];
  const socialEdges: SocialEdge[] = [];

  for (const rel of relationships) {
    const sourceType = rel.sourceEntity.type;
    const targetType = rel.targetEntity.type;

    // CHARACTER -> PLACE (place is in territory)
    if (sourceType === 'CHARACTER' && targetType === 'PLACE') {
      const placeLevel = territory.get(rel.targetEntity.id);
      if (placeLevel) {
        placeEdges.push({
          characterId: rel.sourceEntity.id,
          placeId: rel.targetEntity.id,
          placeLevel,
          chapterIdx: rel.chapter.idx
        });
      }
    }

    // PLACE -> CHARACTER (place is in territory)
    if (sourceType === 'PLACE' && targetType === 'CHARACTER') {
      const placeLevel = territory.get(rel.sourceEntity.id);
      if (placeLevel) {
        placeEdges.push({
          characterId: rel.targetEntity.id,
          placeId: rel.sourceEntity.id,
          placeLevel,
          chapterIdx: rel.chapter.idx
        });
      }
    }

    // CHARACTER -> CHARACTER
    if (sourceType === 'CHARACTER' && targetType === 'CHARACTER') {
      socialEdges.push({
        char1Id: rel.sourceEntity.id,
        char2Id: rel.targetEntity.id,
        chapterIdx: rel.chapter.idx
      });
    }
  }

  const attachmentScores = new Map<string, number>();
  const candidates = new Set<string>();

  // Track which chapters each character interacts with territory
  const characterChaptersInTerritory = new Map<string, Set<number>>();

  for (const edge of placeEdges) {
    const weight = DEPTH_WEIGHTS[edge.placeLevel];

    const current = attachmentScores.get(edge.characterId) ?? 0;
    attachmentScores.set(edge.characterId, current + weight);
    candidates.add(edge.characterId);

    // Track chapters for temporal filtering
    if (!characterChaptersInTerritory.has(edge.characterId)) {
      characterChaptersInTerritory.set(edge.characterId, new Set());
    }
    characterChaptersInTerritory.get(edge.characterId)!.add(edge.chapterIdx);
  }

  const densityScores = new Map<string, number>();
  const socialInteractionCounts = new Map<string, number>();

  for (const edge of socialEdges) {
    // CRITICAL FILTER 1: Both parties must be "Candidates" (attached to the place)
    if (!candidates.has(edge.char1Id) || !candidates.has(edge.char2Id)) {
      continue;
    }

    // CRITICAL FILTER 2: TEMPORAL - Both must have place interactions in THIS chapter
    const char1Chapters = characterChaptersInTerritory.get(edge.char1Id);
    const char2Chapters = characterChaptersInTerritory.get(edge.char2Id);

    if (!char1Chapters?.has(edge.chapterIdx) || !char2Chapters?.has(edge.chapterIdx)) {
      continue;
    }

    // Reinforcement: Add points to BOTH characters.
    // Boost = 10% of their combined Attachment Score.
    const score1 = attachmentScores.get(edge.char1Id) ?? 0;
    const score2 = attachmentScores.get(edge.char2Id) ?? 0;
    const boost = (score1 + score2) * 0.1;

    densityScores.set(edge.char1Id, (densityScores.get(edge.char1Id) ?? 0) + boost);
    densityScores.set(edge.char2Id, (densityScores.get(edge.char2Id) ?? 0) + boost);

    // Track counts for debugging
    socialInteractionCounts.set(
      edge.char1Id,
      (socialInteractionCounts.get(edge.char1Id) ?? 0) + 1
    );
    socialInteractionCounts.set(
      edge.char2Id,
      (socialInteractionCounts.get(edge.char2Id) ?? 0) + 1
    );
  }

  const results: LocalCharacterScore[] = Array.from(candidates).map((charId) => {
    const attachment = attachmentScores.get(charId) ?? 0;
    const density = densityScores.get(charId) ?? 0;

    return {
      characterId: charId,
      characterName: entityIdToName.get(charId) ?? 'Unknown',
      score: attachment + density,
      breakdown: { attachment, density },
      placeInteractions: placeEdges.filter((e) => e.characterId === charId).length,
      socialInteractionsInTerritory: socialInteractionCounts.get(charId) ?? 0
    };
  });

  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}

function getThroughoutCharacters<T extends BaseEntity>(
  relationships: Relationship<T>[]
): Set<string> {
  const throughout = new Set<string>();
  for (const rel of relationships) {
    if (
      rel.sourceEntity.type === 'CHARACTER' &&
      rel.sourceEntity.minorStatus === 'THROUGHOUT'
    ) {
      throughout.add(rel.sourceEntity.id);
    }
    if (
      rel.targetEntity.type === 'CHARACTER' &&
      rel.targetEntity.minorStatus === 'THROUGHOUT'
    ) {
      throughout.add(rel.targetEntity.id);
    }
  }
  return throughout;
}

function buildEntityIdToName<T extends BaseEntity>(
  relationships: Relationship<T>[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const rel of relationships) {
    map.set(rel.sourceEntity.id, rel.sourceEntity.name);
    map.set(rel.targetEntity.id, rel.targetEntity.name);
  }
  return map;
}

function runEpisodicStrategy<T extends BaseEntity>(
  primaryHubs: HubScore[],
  hubTerritories: Map<string, Map<string, EntityHierarchyNode['level']>>,
  relationships: Relationship<T>[]
): GlobalCharacterRanking[] {
  const ineligibleForPrimary = getThroughoutCharacters(relationships);
  // Collect local scores from each hub
  type CharacterAccumulator = {
    characterId: string;
    characterName: string;
    totalGlobalScore: number;
    hubContributions: GlobalCharacterRanking['hubContributions'];
  };

  const characterAccumulators = new Map<string, CharacterAccumulator>();

  // Process each primary hub (ERAs and promoted)
  const activeHubs = primaryHubs.filter((h) => h.isEra || h.isPromoted);

  for (const hub of activeHubs) {
    const territory = hubTerritories.get(hub.hubId);
    if (!territory) {
      continue;
    }

    // Get local cast for this hub
    const localCast = getStructuralLocalCast(
      territory,
      relationships,
      50 // Get more than we need for market share calculation
    );

    if (localCast.length === 0) {
      continue;
    }

    // Calculate total score in this hub (for market share)
    const totalLocalScore = localCast.reduce((sum, c) => sum + c.score, 0);

    // Duration = chapters won by this hub
    const duration = hub.chaptersWon;

    for (const char of localCast.slice(0, 15)) {
      console.log(
        `  ${char.characterName}: score=${char.score.toFixed(2)} (attach=${char.breakdown.attachment.toFixed(2)}, density=${char.breakdown.density.toFixed(2)}), placeInteractions=${char.placeInteractions}, socialInTerritory=${char.socialInteractionsInTerritory}`
      );
    }

    for (const char of localCast) {
      // Market share = this character's % of total activity in the hub
      const marketShare = totalLocalScore > 0 ? char.score / totalLocalScore : 0;

      // Global contribution = marketShare × duration
      const contribution = marketShare * duration;

      if (!characterAccumulators.has(char.characterId)) {
        characterAccumulators.set(char.characterId, {
          characterId: char.characterId,
          characterName: char.characterName,
          totalGlobalScore: 0,
          hubContributions: []
        });
      }

      const acc = characterAccumulators.get(char.characterId)!;
      acc.totalGlobalScore += contribution;
      acc.hubContributions.push({
        hubId: hub.hubId,
        hubName: hub.hubName,
        localScore: char.score,
        marketShare,
        duration,
        contribution
      });
    }
  }

  const sortedCharacters = Array.from(characterAccumulators.values()).sort(
    (a, b) => b.totalGlobalScore - a.totalGlobalScore
  );

  for (const char of sortedCharacters.slice(0, 20)) {
    console.log(
      `  ${char.characterName}: globalScore=${char.totalGlobalScore.toFixed(4)}, hubs=${char.hubContributions.length}`
    );
  }

  const scores = sortedCharacters.map((c) => c.totalGlobalScore);
  const { primary, secondary } = applyRecursiveZScore(
    sortedCharacters,
    scores,
    ineligibleForPrimary
  );

  // Build final results
  const results: GlobalCharacterRanking[] = [];

  for (const char of primary) {
    results.push({
      characterId: char.characterId,
      characterName: char.characterName,
      globalScore: char.totalGlobalScore,
      tier: 'PRIMARY',
      hubContributions: char.hubContributions
    });
  }

  for (const char of secondary) {
    results.push({
      characterId: char.characterId,
      characterName: char.characterName,
      globalScore: char.totalGlobalScore,
      tier: 'SECONDARY',
      hubContributions: char.hubContributions
    });
  }

  return results;
}

function runEnsembleStrategy<T extends BaseEntity>(
  relationships: Relationship<T>[],
  hierarchyRecords: EntityHierarchyNode[]
): GlobalCharacterRanking[] {
  const ineligibleForPrimary = getThroughoutCharacters(relationships);
  const entityIdToName = buildEntityIdToName(relationships);

  // Build place level lookup for depth weighting
  const placeLevel = new Map<string, EntityHierarchyNode['level']>();
  for (const record of hierarchyRecords) {
    placeLevel.set(record.bookEntityId, record.level);
  }

  // Build the full graph first
  const graph = new Graph({ type: 'directed', multi: true });

  for (const rel of relationships) {
    const sourceKey = rel.sourceEntity.id;
    const targetKey = rel.targetEntity.id;

    if (!graph.hasNode(sourceKey)) {
      graph.addNode(sourceKey, {
        entity: rel.sourceEntity,
        type: rel.sourceEntity.type
      });
    }

    if (!graph.hasNode(targetKey)) {
      graph.addNode(targetKey, {
        entity: rel.targetEntity,
        type: rel.targetEntity.type
      });
    }

    graph.addEdge(sourceKey, targetKey, {
      predicateType: rel.predicateType,
      predicateDescription: rel.predicateDescription
    });
  }

  if (graph.order === 0) return [];

  const characterPlaceScores = new Map<string, Map<string, number>>();

  for (const rel of relationships) {
    const sourceType = rel.sourceEntity.type;
    const targetType = rel.targetEntity.type;

    let characterId: string | null = null;
    let placeId: string | null = null;

    // CHARACTER -> PLACE relationship
    if (sourceType === 'CHARACTER' && targetType === 'PLACE') {
      characterId = rel.sourceEntity.id;
      placeId = rel.targetEntity.id;
    }
    // PLACE -> CHARACTER relationship
    else if (sourceType === 'PLACE' && targetType === 'CHARACTER') {
      characterId = rel.targetEntity.id;
      placeId = rel.sourceEntity.id;
    }

    if (characterId && placeId) {
      const level = placeLevel.get(placeId);
      const weight = level ? DEPTH_WEIGHTS[level] : 1;

      if (!characterPlaceScores.has(characterId)) {
        characterPlaceScores.set(characterId, new Map());
      }
      const placeScores = characterPlaceScores.get(characterId)!;
      placeScores.set(placeId, (placeScores.get(placeId) ?? 0) + weight);
    }
  }

  // Build character-only graph
  const characterGraph = buildCharacterOnlyGraph(graph);
  if (characterGraph.order === 0) return [];

  // Calculate chapter spans for weighting
  const chapterSpans = calculateChapterSpans(relationships);

  // Calculate centrality metrics on character-only graph
  const charBetweenness = betweennessCentrality(characterGraph);
  const charPagerank = pagerank(characterGraph);

  const normalizedCharBetweenness = normalizeScores(charBetweenness);
  const normalizedCharPagerank = normalizeScores(charPagerank);

  const charMetrics = extractMetricsFromGraph<T>(
    characterGraph,
    normalizedCharBetweenness,
    normalizedCharPagerank,
    chapterSpans
  );

  // === Calculate protagonist proximity using the shared function ===
  const rawProximity = calculateProtagonistProximity(
    characterGraph,
    normalizedCharBetweenness,
    normalizedCharPagerank,
    chapterSpans
  );
  const normalizedProximity = normalizeScores(rawProximity);

  // Build character list with all three metrics
  type CharWithScore = {
    characterId: string;
    characterName: string;
    combinedScore: number;
    betweenness: number;
    pagerank: number;
    proximity: number;
    rawProximityEdges: number;
  };

  const characters: CharWithScore[] = charMetrics.map((entry) => {
    const proximity = normalizedProximity[entry.entity.id] ?? 0;
    return {
      characterId: entry.entity.id,
      characterName: entry.entity.name,
      // Combined score now includes proximity as a third metric
      combinedScore: Math.max(entry.betweenness, entry.pagerank, proximity),
      betweenness: entry.betweenness,
      pagerank: entry.pagerank,
      proximity,
      rawProximityEdges: rawProximity[entry.entity.id] ?? 0
    };
  });

  // Sort by combined score
  characters.sort((a, b) => b.combinedScore - a.combinedScore);

  if (characters.length === 0) return [];

  // Apply Recursive Z-Score on the graph-based scores
  const scores = characters.map((c) => c.combinedScore);
  const { primary, secondary } = applyRecursiveZScore(
    characters,
    scores,
    ineligibleForPrimary
  );

  // Helper to build hubContributions from characterPlaceScores
  const buildPlaceContributions = (
    characterId: string
  ): GlobalCharacterRanking['hubContributions'] => {
    const placeScores = characterPlaceScores.get(characterId);
    if (!placeScores || placeScores.size === 0) {
      return [];
    }

    // Sort places by score descending, take top 5
    const sortedPlaces = Array.from(placeScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Normalize scores so they sum to character's global score (for consistency with EPISODIC)
    const totalPlaceScore = sortedPlaces.reduce((sum, [, score]) => sum + score, 0);

    return sortedPlaces.map(([placeId, score]) => ({
      hubId: placeId,
      hubName: entityIdToName.get(placeId) ?? placeId,
      localScore: score,
      marketShare: totalPlaceScore > 0 ? score / totalPlaceScore : 0,
      duration: 0, // N/A for ensemble
      contribution: score
    }));
  };

  // Build final results
  const results: GlobalCharacterRanking[] = [];

  for (const char of primary) {
    results.push({
      characterId: char.characterId,
      characterName: char.characterName,
      globalScore: char.combinedScore,
      tier: 'PRIMARY',
      hubContributions: buildPlaceContributions(char.characterId)
    });
  }

  for (const char of secondary) {
    results.push({
      characterId: char.characterId,
      characterName: char.characterName,
      globalScore: char.combinedScore,
      tier: 'SECONDARY',
      hubContributions: buildPlaceContributions(char.characterId)
    });
  }

  return results;
}

function calculateProtagonistProximity(
  characterGraph: Graph,
  betweennessScores: Record<string, number>,
  pagerankScores: Record<string, number>,
  chapterSpans: Map<string, number>
): Record<string, number> {
  if (characterGraph.order === 0) return {};

  // Identify protagonist as the node with highest max(betweenness, pagerank)
  let protagonistId = '';
  let maxScore = -1;

  for (const node of characterGraph.nodes()) {
    const btw = betweennessScores[node] ?? 0;
    const pr = pagerankScores[node] ?? 0;
    const combined = Math.max(btw, pr);
    if (combined > maxScore) {
      maxScore = combined;
      protagonistId = node;
    }
  }

  if (!protagonistId) return {};

  // Get max chapter span for normalization
  const maxChapterSpan = Math.max(...Array.from(chapterSpans.values()), 1);

  // Count edges between each character and the protagonist, weighted by chapter span
  const proximityScores: Record<string, number> = {};

  for (const node of characterGraph.nodes()) {
    const entity = characterGraph.getNodeAttribute(node, 'entity') as BaseEntity;
    const entityId = entity?.id ?? node;

    // Get chapter span weight (same logic as extractMetricsFromGraph)
    const span = chapterSpans.get(entityId) ?? 1;
    const chapterWeight = span / maxChapterSpan;

    if (node === protagonistId) {
      // Protagonist gets max score (will be normalized to 1.0)
      proximityScores[node] = characterGraph.degree(protagonistId) * chapterWeight;
      continue;
    }

    // Count edges in both directions between this node and protagonist
    let protagonistEdges = 0;
    characterGraph.forEachEdge(node, (_edge, _attrs, source, target) => {
      if (source === protagonistId || target === protagonistId) {
        protagonistEdges++;
      }
    });

    // Weight by chapter span - characters who appear briefly get penalized
    proximityScores[node] = protagonistEdges * chapterWeight;
  }

  return proximityScores;
}

function applyRecursiveZScore<T extends { characterId: string; characterName: string }>(
  characters: T[],
  scores: number[],
  ineligibleForPrimary: Set<string> = new Set(),
  primaryZScore: number = 0.5,
  secondaryZScore: number = 0.0
): { primary: T[]; secondary: T[] } {
  if (characters.length === 0) return { primary: [], secondary: [] };

  // Normalize scores to 0-1 range
  const maxScore = Math.max(...scores);
  if (maxScore === 0) return { primary: [], secondary: [] };

  const normalizedScores = scores.map((s) => s / maxScore);

  // Helper to check if character is eligible for PRIMARY
  const canBePrimary = (charId: string) => !ineligibleForPrimary.has(charId);

  const protagonists: T[] = [];
  const remaining: { item: T; normScore: number }[] = [];

  for (let i = 0; i < characters.length; i++) {
    const eligible = canBePrimary(characters[i].characterId);
    const isGodTier = normalizedScores[i] > 0.75 && eligible;
    if (i < 20) {
      console.log(
        `  ${characters[i].characterName}: raw=${scores[i].toFixed(4)}, norm=${normalizedScores[i].toFixed(4)}, eligible=${eligible}, godTier=${isGodTier}`
      );
    }
    if (normalizedScores[i] > 0.75 && eligible) {
      protagonists.push(characters[i]);
    } else {
      remaining.push({ item: characters[i], normScore: normalizedScores[i] });
    }
  }

  if (remaining.length === 0) {
    return { primary: protagonists, secondary: [] };
  }

  const newMax = remaining[0].normScore;
  const reNormalized = remaining.map((e) => ({
    ...e,
    reNormScore: e.normScore / newMax
  }));

  for (const e of reNormalized.slice(0, 15)) {
    console.log(
      `  ${e.item.characterName}: normScore=${e.normScore.toFixed(4)}, reNormScore=${e.reNormScore.toFixed(4)}`
    );
  }

  const reNormalizedScores = reNormalized.map((e) => e.reNormScore);
  const { primaryThreshold } = entityThresholds(
    reNormalizedScores,
    primaryZScore,
    secondaryZScore
  );

  // Initial assignment based on z-score threshold (only eligible characters)
  const initialMainCast = reNormalized.filter(
    (e) => e.reNormScore >= primaryThreshold && canBePrimary(e.item.characterId)
  );
  const potentialSecondary = reNormalized.filter(
    (e) => e.reNormScore < primaryThreshold || !canBePrimary(e.item.characterId)
  );

  const SLIDE_TOLERANCE = 0.2;
  const maxMainCast = MAX_PRIMARY_CHARACTERS - protagonists.length;

  const THIN_CAST_THRESHOLD = 3;

  while (potentialSecondary.length > 0 && initialMainCast.length < maxMainCast) {
    const lastIn = initialMainCast[initialMainCast.length - 1];
    // Find next eligible candidate
    const nextUpIndex = potentialSecondary.findIndex((e) =>
      canBePrimary(e.item.characterId)
    );
    if (nextUpIndex === -1) break;
    const nextUp = potentialSecondary[nextUpIndex];

    if (!lastIn || !nextUp) break;

    const drop = (lastIn.reNormScore - nextUp.reNormScore) / lastIn.reNormScore;
    const totalPrimary = protagonists.length + initialMainCast.length;

    if (drop < SLIDE_TOLERANCE) {
      // Small drop - pull them into PRIMARY
      initialMainCast.push(potentialSecondary.splice(nextUpIndex, 1)[0]);
    } else if (totalPrimary <= THIN_CAST_THRESHOLD) {
      // Big drop BUT cast is too thin - jump the cliff and keep searching
      initialMainCast.push(potentialSecondary.splice(nextUpIndex, 1)[0]);
    } else {
      // Real drop and we have enough characters - stop sliding
      break;
    }
  }

  // Combine protagonists + main cast
  const primary = [...protagonists, ...initialMainCast.map((e) => e.item)].slice(
    0,
    MAX_PRIMARY_CHARACTERS
  );
  const primaryIds = new Set(primary.map((p) => p.characterId));

  const remainingAfterSlide = reNormalized.filter(
    (e) => !primaryIds.has(e.item.characterId)
  );
  const remainingScores = remainingAfterSlide.map((e) => e.reNormScore);
  const { primaryThreshold: postSlideSecondaryThreshold } = entityThresholds(
    remainingScores,
    secondaryZScore,
    secondaryZScore
  );

  const secondary = remainingAfterSlide
    .filter((e) => e.reNormScore >= postSlideSecondaryThreshold)
    .map((e) => e.item);

  return { primary, secondary };
}

function buildCharacterOnlyGraph(graph: Graph) {
  const characterGraph = new Graph({ type: 'directed', multi: true });

  for (const node of graph.nodes()) {
    if (graph.getNodeAttribute(node, 'type') === 'CHARACTER') {
      characterGraph.addNode(node, graph.getNodeAttributes(node));
    }
  }

  for (const edge of graph.edges()) {
    const [source, target] = graph.extremities(edge);
    if (characterGraph.hasNode(source) && characterGraph.hasNode(target)) {
      characterGraph.addEdge(source, target, graph.getEdgeAttributes(edge));
    }
  }

  return characterGraph;
}

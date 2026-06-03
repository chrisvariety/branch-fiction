import Graph from 'graphology';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness.js';
import pagerank from 'graphology-metrics/centrality/pagerank.js';

import { BaseEntity, Relationship } from './relationship-graph';

export type SignificanceTier = 'PRIMARY' | 'SECONDARY';

export type RankedEntity<T extends BaseEntity> = {
  entity: T;
  rankCategoryType: string;
  rank: number;
  significanceTier: SignificanceTier;
};

type EntityMetrics<T extends BaseEntity> = {
  key: string;
  entity: T;
  betweenness: number;
  pagerank: number;
};

type TieredEntity<T extends BaseEntity> = EntityMetrics<T> & {
  tier: SignificanceTier;
};

type RankComputation<T extends BaseEntity> = {
  category: string;
  ranked: RankedEntity<T>[];
};

export function normalizeScores(scores: Record<string, number>): Record<string, number> {
  const values = Object.values(scores);
  if (values.length === 0) return {};

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  // If all values are the same, return 1.0 for all
  if (range === 0) {
    return Object.fromEntries(Object.keys(scores).map((key) => [key, 1.0]));
  }

  return Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [key, (value - min) / range])
  );
}

export function findKneePoint(sortedScores: number[]): number {
  if (sortedScores.length < 3) return 0;

  // Normalize coordinates to [0,1] for stable distance calculation
  const n = sortedScores.length;
  const normalizedPoints = sortedScores.map((score, i) => ({
    x: i / (n - 1), // rank normalized to [0,1]
    y: score / sortedScores[0], // score normalized by max
    originalIndex: i
  }));

  // Calculate perpendicular distance from each point to the line connecting first and last
  const first = normalizedPoints[0];
  const last = normalizedPoints[n - 1];

  // Line equation: ax + by + c = 0
  const a = last.y - first.y;
  const b = first.x - last.x;
  const c = last.x * first.y - first.x * last.y;
  const denominator = Math.sqrt(a * a + b * b);

  let maxDistance = 0;
  let kneeIndex = 0;

  for (let i = 1; i < n - 1; i++) {
    const point = normalizedPoints[i];
    const distance = Math.abs(a * point.x + b * point.y + c) / denominator;

    if (distance > maxDistance) {
      maxDistance = distance;
      kneeIndex = i;
    }
  }

  return kneeIndex;
}

function rankEntities<T extends BaseEntity>(
  entities: EntityMetrics<T>[],
  category: string
): RankComputation<T> {
  if (entities.length === 0) {
    return { category, ranked: [] };
  }

  const entitiesWithCombinedScore = entities.map((entry) => ({
    ...entry,
    combinedScore: Math.max(entry.betweenness, entry.pagerank)
  }));

  // Sort by combined score
  const sortedByCombinedScore = [...entitiesWithCombinedScore].sort(
    (a, b) => b.combinedScore - a.combinedScore
  );

  const eligibleScores = sortedByCombinedScore.map((e) => e.combinedScore);

  // Use Kneedle/Elbow Detection to find PRIMARY threshold (on eligible entities only)
  const kneeIndex = findKneePoint(eligibleScores);
  const kneeScore = eligibleScores[kneeIndex] ?? 0;

  // For SECONDARY, use threshold relative to knee score (adaptive)
  const secondaryKneeMultiplier = 0.3;
  const secondaryThreshold = kneeScore * secondaryKneeMultiplier;

  // Assign tiers using Kneedle for PRIMARY, with PRIMARY capped at 10
  const primaryKeys = new Set<string>();
  const secondaryKeys = new Set<string>();

  const targetPrimaryCount = Math.min(kneeIndex + 1, 10);

  // Iterate through sorted entities to assign PRIMARY
  for (
    let i = 0;
    i < sortedByCombinedScore.length && primaryKeys.size < targetPrimaryCount;
    i++
  ) {
    primaryKeys.add(sortedByCombinedScore[i].key);
  }

  // Then assign SECONDARY to remaining entities
  for (const entry of sortedByCombinedScore) {
    if (!primaryKeys.has(entry.key) && entry.combinedScore >= secondaryThreshold) {
      secondaryKeys.add(entry.key);
    }
  }

  // Build final entities list with assigned tiers
  const finalEntities: TieredEntity<T>[] = entitiesWithCombinedScore
    .filter((entry) => primaryKeys.has(entry.key) || secondaryKeys.has(entry.key))
    .map((entry) => ({
      ...entry,
      tier: (primaryKeys.has(entry.key) ? 'PRIMARY' : 'SECONDARY') as SignificanceTier
    }));

  const sortedFinal = [...finalEntities].sort((a, b) => {
    // First, sort by tier (PRIMARY before SECONDARY)
    if (a.tier !== b.tier) {
      return a.tier === 'PRIMARY' ? -1 : 1;
    }

    // Within same tier, sort by combined score (max of chapter-weighted betweenness and pagerank)
    const combinedScoreB = Math.max(b.betweenness, b.pagerank);
    const combinedScoreA = Math.max(a.betweenness, a.pagerank);

    if (combinedScoreB !== combinedScoreA) {
      return combinedScoreB - combinedScoreA;
    }

    // Tie-breakers: betweenness, then pagerank, then name
    if (b.betweenness !== a.betweenness) {
      return b.betweenness - a.betweenness;
    }

    if (b.pagerank !== a.pagerank) {
      return b.pagerank - a.pagerank;
    }

    return a.entity.name.localeCompare(b.entity.name);
  });

  return {
    category,
    ranked: sortedFinal.map((entry, index) => ({
      entity: entry.entity,
      rankCategoryType: category,
      rank: index + 1,
      significanceTier: entry.tier
    }))
  };
}

export function calculateChapterSpans<T extends BaseEntity>(
  relationships: Relationship<T>[]
): Map<string, number> {
  const entityChapters = new Map<string, Set<number>>();

  for (const rel of relationships) {
    const sourceId = rel.sourceEntity.id;
    const targetId = rel.targetEntity.id;
    const chapterIdx = rel.chapter.idx;

    if (!entityChapters.has(sourceId)) {
      entityChapters.set(sourceId, new Set());
    }
    entityChapters.get(sourceId)!.add(chapterIdx);

    if (!entityChapters.has(targetId)) {
      entityChapters.set(targetId, new Set());
    }
    entityChapters.get(targetId)!.add(chapterIdx);
  }

  const chapterSpans = new Map<string, number>();
  for (const [entityId, chapters] of entityChapters) {
    chapterSpans.set(entityId, chapters.size);
  }

  return chapterSpans;
}

export function extractMetricsFromGraph<T extends BaseEntity>(
  graph: Graph,
  betweennessScores: Record<string, number>,
  pagerankScores: Record<string, number>,
  chapterSpans: Map<string, number>
): EntityMetrics<T>[] {
  const maxChapterSpan = Math.max(...Array.from(chapterSpans.values()), 1);

  return graph.nodes().map((key) => {
    const entity = graph.getNodeAttribute(key, 'entity') as T;
    let betweenness = betweennessScores[key] ?? 0;
    let pagerank = pagerankScores[key] ?? 0;

    // Weight both betweenness and pagerank by chapter span
    if (chapterSpans.has(entity.id)) {
      const span = chapterSpans.get(entity.id)!;
      const chapterWeight = span / maxChapterSpan;
      betweenness = betweenness * chapterWeight;
      pagerank = pagerank * chapterWeight;
    }

    return {
      key,
      entity,
      betweenness,
      pagerank
    };
  });
}

export function analyzeEntitySignificance<T extends BaseEntity>(
  relationships: Relationship<T>[]
): RankedEntity<T>[] {
  if (relationships.length === 0) {
    return [];
  }

  // Calculate chapter spans for weighting betweenness centrality
  const chapterSpans = calculateChapterSpans(relationships);

  const graph = new Graph({ type: 'directed', multi: true });

  for (const relationship of relationships) {
    const sourceKey = relationship.sourceEntity.id;
    const targetKey = relationship.targetEntity.id;

    if (!graph.hasNode(sourceKey)) {
      graph.addNode(sourceKey, {
        entity: relationship.sourceEntity,
        type: relationship.sourceEntity.type
      });
    }

    if (!graph.hasNode(targetKey)) {
      graph.addNode(targetKey, {
        entity: relationship.targetEntity,
        type: relationship.targetEntity.type
      });
    }

    graph.addEdge(sourceKey, targetKey, {
      predicateType: relationship.predicateType,
      predicateDescription: relationship.predicateDescription
    });
  }

  if (graph.order === 0) {
    return [];
  }

  const betweennessScores = betweennessCentrality(graph);
  const pagerankScores = pagerank(graph);

  // Normalize scores to 0-1 scale for fair comparison
  const normalizedBetweenness = normalizeScores(betweennessScores);
  const normalizedPagerank = normalizeScores(pagerankScores);

  const allEntities = extractMetricsFromGraph<T>(
    graph,
    normalizedBetweenness,
    normalizedPagerank,
    chapterSpans
  );

  const rankings: RankComputation<T>[] = [];

  rankings.push(rankEntities(allEntities, 'OVERALL'));

  const entitiesByType = new Map<string, EntityMetrics<T>[]>();

  for (const entityMetrics of allEntities) {
    const list = entitiesByType.get(entityMetrics.entity.type);
    if (list) {
      list.push(entityMetrics);
    } else {
      entitiesByType.set(entityMetrics.entity.type, [entityMetrics]);
    }
  }

  for (const [entityType, metrics] of entitiesByType.entries()) {
    rankings.push(rankEntities(metrics, entityType));
  }

  return rankings.flatMap((entry) => entry.ranked);
}

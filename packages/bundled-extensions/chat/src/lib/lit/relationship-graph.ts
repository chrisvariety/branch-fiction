import Graph from 'graphology';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness.js';
import { singleSource } from 'graphology-shortest-path/unweighted.js';
import { edgePathFromNodePath } from 'graphology-shortest-path/utils.js';
import { allSimpleEdgeGroupPaths } from 'graphology-simple-path';

import { entityThresholds } from '../lit/entity-significance-estimate';

export type BaseEntity = {
  id: string;
  name: string;
  type: string;
  minorStatus?: 'NEVER' | 'THROUGHOUT' | 'UNTIL_CHAPTER';
};

export type Relationship<T extends BaseEntity> = {
  sourceEntity: T;
  targetEntity: T;
  predicateType: string;
  predicateDescription?: string;
  chapter: {
    id: string;
    idx: number;
  };
};

export function buildRelationshipGraph<T extends Relationship<BaseEntity>>(
  relationships: T[],
  filterFn?: (relationship: T) => boolean
) {
  const graph = new Graph({ type: 'undirected', multi: true });
  for (const relationship of relationships) {
    const sourceKey = relationship.sourceEntity.id;
    const targetKey = relationship.targetEntity.id;

    if (filterFn && !filterFn(relationship)) {
      continue;
    }

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
      predicateDescription: relationship.predicateDescription,
      chapterIdx: relationship.chapter.idx
    });
  }

  return graph;
}

/**
 * Identifies anchor characters — the most connected CHARACTER nodes in the graph
 * using z-score thresholds on degree distribution.
 * Starts with an aggressive z-score (2.5) and lowers until at least 1 anchor is found.
 * Falls back to the single highest-degree character.
 */
export function findAnchorCharacterIds(graph: Graph): Set<string> {
  const characterDegrees: Array<{ id: string; degree: number }> = [];
  graph.forEachNode((nodeId, attrs) => {
    if (attrs.type === 'CHARACTER') {
      characterDegrees.push({ id: nodeId, degree: graph.degree(nodeId) });
    }
  });

  if (characterDegrees.length === 0) {
    return new Set();
  }

  characterDegrees.sort((a, b) => b.degree - a.degree);

  const degrees = characterDegrees.map((c) => c.degree);
  const zScoreThresholds = [2.5, 2.0, 1.5, 1.0, 0.5];

  for (const zScore of zScoreThresholds) {
    const { primaryThreshold } = entityThresholds(degrees, zScore);
    const anchorIds = new Set(
      characterDegrees.filter((c) => c.degree >= primaryThreshold).map((c) => c.id)
    );
    if (anchorIds.size > 0) {
      return anchorIds;
    }
  }

  // Final fallback: highest degree character
  return new Set([characterDegrees[0].id]);
}

export function findAllPathsWithinNHops(graph: Graph, nodeId: string, maxDepth: number) {
  // First, find all nodes within maxDepth hops to know which nodes to search for
  const shortestPaths = singleSource(graph, nodeId);
  const reachableNodes = Object.keys(shortestPaths).filter((targetNode) => {
    const distance = shortestPaths[targetNode].length - 1;
    return distance <= maxDepth && distance > 0;
  });

  const results: Array<{
    node: string;
    depth: number;
    cypherPath: string;
  }> = [];

  // For each reachable node, find ALL paths to it
  const seenPaths = new Set<string>();

  for (const targetNode of reachableNodes) {
    const edgeGroupPaths = allSimpleEdgeGroupPaths(graph, nodeId, targetNode, {
      maxDepth
    });

    for (const edgeGroups of edgeGroupPaths) {
      // Each edgeGroup is an array of edge arrays (representing alternative edges between same nodes)
      // We need to generate all combinations by picking one edge from each group
      const edgePathCombinations = cartesianProduct(edgeGroups);

      for (const edgePath of edgePathCombinations) {
        const nodePath = nodePathFromEdgePath(graph, nodeId, edgePath);
        const cypherPath = buildCypherFromPath(graph, nodePath.reverse());

        // Deduplicate based on cypher path (multiple edges with same attributes produce identical paths)
        if (!seenPaths.has(cypherPath)) {
          seenPaths.add(cypherPath);
          results.push({
            node: targetNode,
            depth: nodePath.length - 1,
            cypherPath
          });
        }
      }
    }
  }

  return results;
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  if (arrays.length === 1) return arrays[0].map((item) => [item]);

  const [first, ...rest] = arrays;
  const restProduct = cartesianProduct(rest);

  return first.flatMap((item) => restProduct.map((restItems) => [item, ...restItems]));
}

function nodePathFromEdgePath(
  graph: Graph,
  startNode: string,
  edgePath: string[]
): string[] {
  const nodePath = [startNode];
  let currentNode = startNode;

  for (const edgeId of edgePath) {
    const [source, target] = graph.extremities(edgeId);
    currentNode = source === currentNode ? target : source;
    nodePath.push(currentNode);
  }

  return nodePath;
}

export function buildCypherFromPath(graph: Graph, pathNodeIds: string[]): string {
  const segments: string[] = [];
  const edgePath = edgePathFromNodePath(graph, pathNodeIds);

  for (let i = 0; i < edgePath.length; i++) {
    const edgeId = edgePath[i];
    const fromNode = pathNodeIds[i];

    const fromEntity = graph.getNodeAttribute(fromNode, 'entity');
    const edgeAttrs = graph.getEdgeAttributes(edgeId);
    const description = (edgeAttrs.predicateDescription || '').replace(/"/g, '\\"');

    segments.push(
      `(${fromEntity.name})-[:${edgeAttrs.predicateType} {chapter: ${edgeAttrs.chapterIdx}, description: "${description}"}]->`
    );
  }

  // Add final node (the one we started the search with, e.g. the place or character)
  const finalEntity = graph.getNodeAttribute(
    pathNodeIds[pathNodeIds.length - 1],
    'entity'
  );
  segments.push(`(${finalEntity.name})`);

  return segments.join('');
}

export type BridgeCharacter = {
  id: string;
  name: string;
  pathFrequency: number; // How many paths between target entities this character appears in
  degree: number;
};

/**
 * Finds bridge characters by counting how often they appear on paths between target entities.
 * This is much faster than betweenness centrality* and focuses on local connectivity.
 * * when maxHops is about 2
 *
 * @param graph - The relationship graph
 * @param targetEntityIds - Entity IDs to find bridges between (must provide at least 2)
 * @param limit - Maximum number of bridge characters to return
 * @param maxHops - Maximum path length to consider (default: 2)
 * @returns Array of bridge characters sorted by path frequency
 */
export function findBridgeCharacters(
  graph: Graph,
  targetEntityIds: string[],
  limit: number = 10,
  maxHops: number = 2
): BridgeCharacter[] {
  if (!targetEntityIds || targetEntityIds.length < 2) {
    return [];
  }

  // Count how many paths each character appears in
  const characterPathCounts = new Map<string, number>();

  // Find paths between all pairs of target entities
  for (let i = 0; i < targetEntityIds.length; i++) {
    for (let j = i + 1; j < targetEntityIds.length; j++) {
      const sourceId = targetEntityIds[i];
      const targetId = targetEntityIds[j];

      if (!graph.hasNode(sourceId) || !graph.hasNode(targetId)) {
        continue;
      }

      // Find paths using findAllPathsWithinNHops
      const paths = findAllPathsWithinNHops(graph, sourceId, maxHops);
      const pathsToTarget = paths.filter((p) => p.node === targetId);

      // Extract intermediate character nodes from these paths
      for (const path of pathsToTarget) {
        const nodeMatches = path.cypherPath.matchAll(/\(([^)]+)\)/g);
        const pathNodeNames = Array.from(nodeMatches).map((match) => match[1]);

        const sourceName = graph.getNodeAttribute(sourceId, 'entity').name;
        const targetName = graph.getNodeAttribute(targetId, 'entity').name;

        const intermediates = pathNodeNames.filter(
          (name) => name !== sourceName && name !== targetName
        );

        // Map names back to IDs and filter to CHARACTER type
        graph.forEachNode((nodeId, attrs) => {
          if (intermediates.includes(attrs.entity.name) && attrs.type === 'CHARACTER') {
            characterPathCounts.set(nodeId, (characterPathCounts.get(nodeId) || 0) + 1);
          }
        });
      }
    }
  }

  // Convert to array and sort by frequency
  const bridgeCharacters: BridgeCharacter[] = Array.from(
    characterPathCounts.entries()
  ).map(([nodeId, count]) => ({
    id: nodeId,
    name: graph.getNodeAttribute(nodeId, 'entity').name,
    pathFrequency: count,
    degree: graph.degree(nodeId)
  }));

  // Sort by path frequency (primary) and degree (secondary)
  return bridgeCharacters
    .sort((a, b) => {
      if (a.pathFrequency !== b.pathFrequency) {
        return b.pathFrequency - a.pathFrequency;
      }
      return b.degree - a.degree;
    })
    .slice(0, limit);
}

export type CharacterCluster = {
  characters: Array<{ id: string; name: string; type: string }>;
  hubIds: string[];
  clusterType: 'gravity' | 'triangle' | 'orbit';
  label?: string;
};

/**
 * Optional orbit family classification.
 * Maps relationship types to family names (e.g., 'antagonist', 'family', 'protector').
 * Can be generated externally (e.g., via LLM classification) and passed in.
 */
export type OrbitFamilies = Map<string, string>;

/**
 * Clusters characters into gravity pairs, triads, bridges, and orbits for arc extraction.
 * @param relationships - Array of relationships with predicateType
 * @param selectableCharacters - Characters to cluster
 * @param gravityPercentile - Percentile threshold for gravity pairs (default: 90 = top 10%)
 * @param triangleMinWeight - Minimum edge weight for triangle inclusion (default: 3)
 * @param orbitFamilies - Optional map of predicateType -> family name for orbit sub-clustering
 * @returns Array of character clusters with type labels
 */
export function clusterCharactersByHub<
  T extends {
    sourceEntity: { id: string; name: string; type: string };
    targetEntity: { id: string; name: string; type: string };
    predicateType: string;
  }
>(
  relationships: T[],
  selectableCharacters: Array<{ id: string; name: string; type: string }>,
  gravityPercentile: number = 90,
  triangleMinWeight: number = 3,
  orbitFamilies?: OrbitFamilies
): CharacterCluster[] {
  // Build weighted graph
  const graph = new Graph({ type: 'undirected', multi: false });
  const characterIds = new Set(selectableCharacters.map((c) => c.id));

  // Track relationship types per character pair
  const pairRelTypes = new Map<string, Set<string>>();

  for (const rel of relationships) {
    const sourceId = rel.sourceEntity.id;
    const targetId = rel.targetEntity.id;

    if (!characterIds.has(sourceId) || !characterIds.has(targetId)) {
      continue;
    }

    if (!graph.hasNode(sourceId)) {
      graph.addNode(sourceId, {
        name: rel.sourceEntity.name,
        type: rel.sourceEntity.type
      });
    }

    if (!graph.hasNode(targetId)) {
      graph.addNode(targetId, {
        name: rel.targetEntity.name,
        type: rel.targetEntity.type
      });
    }

    if (graph.hasEdge(sourceId, targetId)) {
      const currentWeight = graph.getEdgeAttribute(sourceId, targetId, 'weight');
      graph.setEdgeAttribute(sourceId, targetId, 'weight', currentWeight + 1);
    } else {
      graph.addEdge(sourceId, targetId, { weight: 1 });
    }

    // Track relationship types
    const pairKey = [sourceId, targetId].sort().join('|');
    if (!pairRelTypes.has(pairKey)) {
      pairRelTypes.set(pairKey, new Set());
    }
    pairRelTypes.get(pairKey)!.add(rel.predicateType);
  }

  if (graph.order === 0) {
    return [];
  }

  // Find protagonist (highest weighted degree)
  let protagonist: string | null = null;
  let maxDegree = 0;
  graph.forEachNode((nodeId) => {
    let degree = 0;
    graph.forEachEdge(nodeId, (_edge, attrs) => {
      degree += attrs.weight;
    });
    if (degree > maxDegree) {
      maxDegree = degree;
      protagonist = nodeId;
    }
  });

  if (!protagonist) {
    return [];
  }

  // Re-assign to const for TypeScript narrowing
  const protagonistId: string = protagonist;

  // Calculate adaptive thresholds based on edge weight distribution
  const weights: number[] = [];
  graph.forEachEdge((_edge, attrs) => {
    weights.push(attrs.weight);
  });
  weights.sort((a, b) => a - b);

  const gravityThreshold =
    weights.length > 0
      ? weights[Math.floor((weights.length - 1) * (gravityPercentile / 100))]
      : 1;

  const clusters: CharacterCluster[] = [];
  const assigned = new Set<string>();

  // === TIER 1: Gravity Pairs ===
  // High-interaction pairs get dedicated clusters
  graph.forEachNeighbor(protagonistId, (neighborId) => {
    const weight = graph.getEdgeAttribute(protagonistId, neighborId, 'weight');
    if (weight >= gravityThreshold) {
      const chars = [protagonistId, neighborId].map((id) => ({
        id,
        name: graph.getNodeAttribute(id, 'name'),
        type: graph.getNodeAttribute(id, 'type')
      }));

      clusters.push({
        characters: chars,
        hubIds: [protagonistId],
        clusterType: 'gravity',
        label: `gravity_${graph.getNodeAttribute(protagonistId, 'name')}_${graph.getNodeAttribute(neighborId, 'name')}`
      });
      assigned.add(neighborId);
    }
  });

  // === TIER 2: Closed Triads ===
  // Find triangles where all edges have meaningful weight
  const triangles = new Set<string>();
  const protagonistIdNeighbors = graph.neighbors(protagonistId);

  for (let i = 0; i < protagonistIdNeighbors.length; i++) {
    const n1 = protagonistIdNeighbors[i];
    for (let j = i + 1; j < protagonistIdNeighbors.length; j++) {
      const n2 = protagonistIdNeighbors[j];

      if (graph.hasEdge(n1, n2)) {
        // Check all edges meet threshold
        const w1 = graph.getEdgeAttribute(protagonistId, n1, 'weight');
        const w2 = graph.getEdgeAttribute(protagonistId, n2, 'weight');
        const w3 = graph.getEdgeAttribute(n1, n2, 'weight');

        if (
          w1 >= triangleMinWeight &&
          w2 >= triangleMinWeight &&
          w3 >= triangleMinWeight
        ) {
          const triangleKey = [protagonistId, n1, n2].sort().join('|');
          if (!triangles.has(triangleKey)) {
            triangles.add(triangleKey);

            const chars = [protagonistId, n1, n2].map((id) => ({
              id,
              name: graph.getNodeAttribute(id, 'name'),
              type: graph.getNodeAttribute(id, 'type')
            }));

            clusters.push({
              characters: chars,
              hubIds: [protagonistId],
              clusterType: 'triangle',
              label: `triangle_${chars.map((c) => c.name).join('_')}`
            });
            assigned.add(n1);
            assigned.add(n2);
          }
        }
      }
    }
  }

  // === TIER 3: Bridge Characters ===
  // Use betweenness centrality to find characters who bridge different clusters
  const betweennessScores = betweennessCentrality(graph);

  // Sort unassigned characters by betweenness (highest first)
  const bridgeCandidates = Object.entries(betweennessScores)
    .filter(([nodeId]) => nodeId !== protagonistId && !assigned.has(nodeId))
    .sort((a, b) => b[1] - a[1]);

  // Add high-betweenness characters to gravity pairs they connect to
  for (const [bridgeId, score] of bridgeCandidates) {
    if (score > 0) {
      // Find the gravity cluster this bridge connects to
      for (const cluster of clusters) {
        if (cluster.clusterType === 'gravity' && cluster.characters.length < 4) {
          const gravityPartner = cluster.characters.find(
            (c) => c.id !== protagonistId
          )?.id;
          if (gravityPartner && graph.hasEdge(bridgeId, gravityPartner)) {
            cluster.characters.push({
              id: bridgeId,
              name: graph.getNodeAttribute(bridgeId, 'name'),
              type: graph.getNodeAttribute(bridgeId, 'type')
            });
            assigned.add(bridgeId);
            break;
          }
        }
      }
    }
  }

  // === TIER 4: Orbit Characters ===
  // Remaining characters, grouped by relationship family (defaults to 'leftovers')
  const orbit = new Set<string>();
  graph.forEachNeighbor(protagonistId, (neighborId) => {
    if (!assigned.has(neighborId)) {
      orbit.add(neighborId);
    }
  });

  if (orbit.size > 0) {
    const orbitByFamily = new Map<string, Set<string>>();

    for (const charId of orbit) {
      const pairKey = [protagonistId, charId].sort().join('|');
      const relTypes = pairRelTypes.get(pairKey) || new Set();

      let familyAssigned = false;
      if (orbitFamilies) {
        for (const relType of relTypes) {
          const family = orbitFamilies.get(relType);
          if (family) {
            if (!orbitByFamily.has(family)) {
              orbitByFamily.set(family, new Set());
            }
            orbitByFamily.get(family)!.add(charId);
            familyAssigned = true;
            break;
          }
        }
      }

      // Characters without family classification go to 'leftovers'
      if (!familyAssigned) {
        if (!orbitByFamily.has('leftovers')) {
          orbitByFamily.set('leftovers', new Set());
        }
        orbitByFamily.get('leftovers')!.add(charId);
      }
    }

    // Create orbit clusters per family
    for (const [family, charIds] of orbitByFamily) {
      if (charIds.size > 0) {
        const chars = [
          {
            id: protagonistId,
            name: graph.getNodeAttribute(protagonistId, 'name'),
            type: graph.getNodeAttribute(protagonistId, 'type')
          },
          ...Array.from(charIds).map((id) => ({
            id,
            name: graph.getNodeAttribute(id, 'name'),
            type: graph.getNodeAttribute(id, 'type')
          }))
        ];

        clusters.push({
          characters: chars,
          hubIds: [protagonistId],
          clusterType: 'orbit',
          label: `orbit_${family}`
        });
      }
    }
  }

  return clusters;
}

import { AnchorScore, getPrimaryAnchors } from './place-significance';
import { BaseEntity, Relationship } from './relationship-graph';

export type EntityHierarchyNode = {
  bookEntityId: string;
  level: 'REALM' | 'HUB' | 'LOCALE' | 'MICRO';
  parentBookEntityId: string | null;
};

type ProcessedEntityHierarchyNode = EntityHierarchyNode & {
  descendantCount: number; // pre-calculated weighted count
};

type EntityMap = Map<
  string, // entity ID
  ProcessedEntityHierarchyNode
>;

export type HierarchyData = {
  entities: EntityMap;
  hubEraCount: number; // how many HUBs dominate 2+ chapters
  localeEraCount: number; // how many LOCALEs dominate 2+ chapters
  useHierarchy: boolean; // true if ≥2 ERAs at either level
  preferredLevel: 'HUB' | 'LOCALE' | null; // which level to emphasize (ERA-based)
  anchors: AnchorScore[]; // anchors for the preferred level
};

export function buildPlaceHierarchy(
  hierarchies: EntityHierarchyNode[],
  startEntityId: string
): string[] {
  // Create a map of parent to children
  const childrenMap = new Map<string, string[]>();

  for (const hierarchy of hierarchies) {
    if (hierarchy.parentBookEntityId) {
      const children = childrenMap.get(hierarchy.parentBookEntityId) || [];
      children.push(hierarchy.bookEntityId);
      childrenMap.set(hierarchy.parentBookEntityId, children);
    }
  }

  // Find all descendants of the start entity (including the start entity itself)
  const placeEntityIds: string[] = [startEntityId];
  const queue = [startEntityId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = childrenMap.get(currentId) || [];

    for (const childId of children) {
      placeEntityIds.push(childId);
      queue.push(childId);
    }
  }

  return placeEntityIds;
}

export function buildPlaceHierarchyPaths(
  hierarchies: EntityHierarchyNode[],
  placeEntityIds: string[],
  entityIdToName: Map<string, string>
): Record<string, string> {
  const entityToHierarchy = new Map(hierarchies.map((h) => [h.bookEntityId, h]));
  const paths: Record<string, string> = {};

  for (const entityId of placeEntityIds) {
    const pathParts: string[] = [];
    let currentId: string | null = entityId;

    // Walk up the hierarchy to build the path
    while (currentId) {
      const name = entityIdToName.get(currentId);
      if (name) {
        pathParts.unshift(name);
      }
      const hierarchy = entityToHierarchy.get(currentId);
      currentId = hierarchy?.parentBookEntityId || null;
    }

    paths[entityId] = pathParts.join(' > ');
  }

  return paths;
}

export function processHierarchyData<T extends BaseEntity>(
  hierarchies: Array<{
    bookEntityId: string;
    level: 'REALM' | 'HUB' | 'LOCALE' | 'MICRO';
    parentBookEntityId: string | null;
  }>,
  relationships: Relationship<T>[]
): HierarchyData {
  // 1. Build parent->children map with depth tracking
  const childrenMap = new Map<string, Array<{ id: string; relativeDepth: number }>>();

  for (const h of hierarchies) {
    const parentId = h.parentBookEntityId;
    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      // Calculate relative depth: if parent is at depth 1 and child is at depth 2, relative = 1
      childrenMap.get(parentId)!.push({
        id: h.bookEntityId,
        relativeDepth: 1 // Will be calculated recursively
      });
    }
  }

  // 2. For each entity, count weighted descendants
  // Use exponential decay: direct children = 1.0, grandchildren = 0.5, great-grand = 0.25
  function countWeightedDescendants(entityId: string, currentDepth: number = 0): number {
    const children = childrenMap.get(entityId) || [];
    if (children.length === 0) return 0;

    const depthMultiplier = Math.pow(0.5, currentDepth);
    let count = children.length * depthMultiplier;

    for (const child of children) {
      count += countWeightedDescendants(child.id, currentDepth + 1);
    }

    return count;
  }

  // 3. Build entity map
  const entities: EntityMap = new Map();

  for (const h of hierarchies) {
    const descendantCount = countWeightedDescendants(h.bookEntityId);

    entities.set(h.bookEntityId, {
      bookEntityId: h.bookEntityId,
      level: h.level,
      parentBookEntityId: h.parentBookEntityId,
      descendantCount
    });
  }

  const entityIdToName = new Map<string, string>();
  for (const h of hierarchies) {
    entityIdToName.set(h.bookEntityId, h.bookEntityId);
  }

  const hubAnchors = getPrimaryAnchors(relationships, hierarchies, entityIdToName, 'HUB');
  const localeAnchors = getPrimaryAnchors(
    relationships,
    hierarchies,
    entityIdToName,
    'LOCALE'
  );

  const hubEraCount = hubAnchors.filter((a) => a.isEra).length;
  const localeEraCount = localeAnchors.filter((a) => a.isEra).length;

  let preferredLevel: 'HUB' | 'LOCALE' | null = null;
  if (hubEraCount >= 2) {
    preferredLevel = 'HUB';
  } else if (localeEraCount > hubEraCount) {
    preferredLevel = 'LOCALE';
  } else if (hubEraCount >= 1) {
    preferredLevel = 'HUB';
  } else if (localeEraCount >= 1) {
    preferredLevel = 'LOCALE';
  }

  const useHierarchy = hubEraCount >= 2 || localeEraCount >= 2;
  const anchors = preferredLevel === 'LOCALE' ? localeAnchors : hubAnchors;

  return {
    entities,
    hubEraCount,
    localeEraCount,
    useHierarchy,
    preferredLevel,
    anchors
  };
}

export function computeHierarchyScore(
  hierarchy: ProcessedEntityHierarchyNode,
  mode: 'HUB' | 'LOCALE'
): number {
  if (mode === 'HUB' && hierarchy.level === 'REALM') return 0;

  const weights =
    mode === 'HUB'
      ? { HUB: 1.0, LOCALE: 0.5, MICRO: 0.25, REALM: 0.1 }
      : { LOCALE: 1.0, MICRO: 0.5, HUB: 0.25, REALM: 0.1 };

  const weight = weights[hierarchy.level] ?? 0;
  return weight * (1 + hierarchy.descendantCount);
}

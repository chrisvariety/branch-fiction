import { watchAgent } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { v7 as uuidv7 } from 'uuid';

import { createBookEntityHierarchies } from '@/lib/db/models/book-entity-hierarchy/create-book-entity-hierarchy';
import { getBookEntityHierarchiesByBookId } from '@/lib/db/models/book-entity-hierarchy/get-book-entity-hierarchy';
import { getBookEntitiesByBookIdAndTypes } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getChapterEntityAttributesByBookEntityIdsAndCategories } from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import { getChapterRelationshipsWithChapterAndEntitiesByBookId } from '@/lib/db/models/chapter-relationship/get-chapter-relationship';
import { buildRelationshipGraph } from '@/lib/lit/relationship-graph';
import extractHierarchyPrompt from '@/lib/prompts/post-processing/extract-hierarchy';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

const LEVEL_MAP = {
  0: 'UNKNOWN',
  1: 'REALM',
  2: 'HUB',
  3: 'LOCALE',
  4: 'MICRO'
} as const;

const BACKUP_LEVEL_MAP = {
  Unknown: 'UNKNOWN',
  Realm: 'REALM',
  Hub: 'HUB',
  Locale: 'LOCALE',
  Micro: 'MICRO'
} as const;

export const handler = createWorkflowFunction<
  {
    bookId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
  },
  { bookId: string; hierarchiesCreated: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Extract Hierarchy ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { book };
    },
    check: async (_payload, result) => ({
      passed: result.hierarchiesCreated > 0,
      severity: 'WARN' as const,
      metadata: { hierarchiesCreated: result.hierarchiesCreated }
    })
  },
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting hierarchy extraction');

    await ctx.narrate('Mapping the hubs, and hidden corners of the world.');

    const existingHierarchies = await getBookEntityHierarchiesByBookId(book.id);
    if (existingHierarchies.length > 0) {
      ctx.log.info(
        `Skipping hierarchy extraction - ${existingHierarchies.length} hierarchies already exist`
      );
      return {
        bookId: book.id,
        hierarchiesCreated: 0
      };
    }

    const entities = await getBookEntitiesByBookIdAndTypes(book.id, ['PLACE']);

    if (entities.length === 0) {
      ctx.log.info('No PLACE entities found for hierarchy extraction');
      return {
        bookId: book.id,
        hierarchiesCreated: 0
      };
    }

    const spatialAttributes =
      await getChapterEntityAttributesByBookEntityIdsAndCategories(
        entities.map((e) => e.id),
        ['SPATIAL']
      );

    const attributesByEntity = new Map<
      string,
      Array<{ category: string; name: string; value: string; evidence: string }>
    >();

    for (const attr of spatialAttributes) {
      if (!attributesByEntity.has(attr.bookEntityId)) {
        attributesByEntity.set(attr.bookEntityId, []);
      }
      attributesByEntity.get(attr.bookEntityId)!.push({
        category: attr.category,
        name: attr.name,
        value: attr.value,
        evidence: attr.evidence
      });
    }

    const places = entities
      .map((entity) => {
        const attributes = attributesByEntity.get(entity.id) || [];

        return {
          id: entity.friendlyId,
          name: entity.name,
          description: entity.description,
          attributes
        };
      })
      .filter((place) => place.attributes.length > 0);

    if (places.length === 0) {
      ctx.log.info('No places with spatial attributes to classify');
      return {
        bookId: book.id,
        hierarchiesCreated: 0
      };
    }

    ctx.log.info(
      `Found ${places.length} PLACE entities with spatial attributes to classify`
    );

    const allRelationships = await getChapterRelationshipsWithChapterAndEntitiesByBookId(
      book.id
    );

    const placeFriendlyIds = new Set(places.map((p) => p.id));
    const placeRelationshipDedup = new Map<string, (typeof allRelationships)[number]>();
    for (const rel of allRelationships) {
      if (rel.sourceEntity.type !== 'PLACE' || rel.targetEntity.type !== 'PLACE') {
        continue;
      }
      if (
        !placeFriendlyIds.has(rel.sourceEntity.friendlyId) ||
        !placeFriendlyIds.has(rel.targetEntity.friendlyId)
      ) {
        continue;
      }
      const key = `${rel.sourceEntity.friendlyId}|${rel.predicateType}|${rel.targetEntity.friendlyId}`;
      if (!placeRelationshipDedup.has(key)) {
        placeRelationshipDedup.set(key, rel);
      }
    }
    const placeRelationships = Array.from(placeRelationshipDedup.values()).map((rel) => ({
      source_id: rel.sourceEntity.friendlyId,
      source_name: rel.sourceEntity.name,
      predicate: rel.predicateType,
      target_id: rel.targetEntity.friendlyId,
      target_name: rel.targetEntity.name,
      description: rel.predicateDescription
    }));

    ctx.log.info(
      `Prepared ${placeRelationships.length} unique place-to-place relationships for hierarchy extraction`
    );

    const hierarchyResult = await extractHierarchy(
      { places, relationships: placeRelationships },
      ctx
    );

    const friendlyIdToEntityId = new Map(
      entities.map((entity) => [entity.friendlyId, entity.id])
    );

    // filter out tier 0 (UNKNOWN) classifications before inserting
    const classificationsToSave = hierarchyResult.classifications.filter(
      (classification) => classification.tier !== 0
    );

    const hierarchiesToInsert = classificationsToSave.flatMap((classification) => {
      const bookEntityId = friendlyIdToEntityId.get(classification.id);
      if (!bookEntityId) {
        throw new RecoverableError(
          `Entity not found for classification ID: ${classification.id}`
        );
      }

      const parentBookEntityId = classification.parent_id
        ? (friendlyIdToEntityId.get(classification.parent_id) ?? null)
        : null;

      let level = LEVEL_MAP[classification.tier as keyof typeof LEVEL_MAP];
      if (!level) {
        level =
          BACKUP_LEVEL_MAP[classification.tier_label as keyof typeof BACKUP_LEVEL_MAP];

        if (!level) {
          throw new RecoverableError(
            `Invalid tier: ${classification.tier} (${classification.tier_label}) for entity ${classification.id}`
          );
        }
      }

      if (level === 'UNKNOWN') {
        return [];
      }

      return [
        {
          id: uuidv7(),
          bookId: book.id,
          bookEntityId,
          level,
          parentBookEntityId,
          classificationReasoning: classification.reasoning,
          significanceRank: null as number | null
        }
      ];
    });

    const hubCount = hierarchiesToInsert.filter((h) => h.level === 'HUB').length;
    const localeCount = hierarchiesToInsert.filter((h) => h.level === 'LOCALE').length;

    if (hubCount === 0 && localeCount < 2) {
      for (const h of hierarchiesToInsert) {
        if (h.level === 'REALM') {
          h.level = 'HUB';
        }
      }

      ctx.log.info(`Demoted REALMs to HUBs (no HUBs detected, ${localeCount} LOCALEs)`);
    }

    // Calculate significanceRank for LOCALEs and MICROs within each HUB
    if (hierarchiesToInsert.length > 0) {
      const graph = buildRelationshipGraph(allRelationships);

      const hierarchyByEntityId = new Map(
        hierarchiesToInsert.map((h) => [h.bookEntityId, h])
      );

      const characterInteractions = new Map<string, number>();
      for (const hierarchy of hierarchiesToInsert) {
        if (hierarchy.level === 'HUB' || hierarchy.level === 'REALM') continue;

        let interactions = 0;
        if (graph.hasNode(hierarchy.bookEntityId)) {
          graph.forEachEdge(hierarchy.bookEntityId, (_edge, _attrs, source, target) => {
            const neighborId = source === hierarchy.bookEntityId ? target : source;
            const neighborType = graph.getNodeAttribute(neighborId, 'type');
            if (neighborType === 'CHARACTER') {
              interactions++;
            }
          });
        }
        characterInteractions.set(hierarchy.bookEntityId, interactions);
      }

      // Find root HUB for each place (walk up parent chain until we hit a HUB)
      function findRootHub(entityId: string): string | null {
        const hierarchy = hierarchyByEntityId.get(entityId);
        if (!hierarchy) return null;
        if (hierarchy.level === 'HUB') return entityId;
        if (hierarchy.parentBookEntityId) {
          return findRootHub(hierarchy.parentBookEntityId);
        }
        return null;
      }

      // Group LOCALEs and MICROs by their root HUB
      const placesByHub = new Map<string, typeof hierarchiesToInsert>();
      for (const hierarchy of hierarchiesToInsert) {
        if (hierarchy.level === 'HUB' || hierarchy.level === 'REALM') continue;

        const rootHubId = findRootHub(hierarchy.bookEntityId);
        if (!rootHubId) continue;

        if (!placesByHub.has(rootHubId)) {
          placesByHub.set(rootHubId, []);
        }
        placesByHub.get(rootHubId)!.push(hierarchy);
      }

      // Rank within each HUB group by character interactions
      for (const [hubId, places] of placesByHub) {
        places.sort((a, b) => {
          const aInteractions = characterInteractions.get(a.bookEntityId) ?? 0;
          const bInteractions = characterInteractions.get(b.bookEntityId) ?? 0;
          return bInteractions - aInteractions;
        });

        places.forEach((place, idx) => {
          place.significanceRank = idx + 1;
        });

        const hubName = entities.find((e) => e.id === hubId)?.name ?? hubId;
        ctx.log.info(`Ranked ${places.length} places within HUB "${hubName}"`);
      }
    }

    if (hierarchiesToInsert.length > 0) {
      await createBookEntityHierarchies(hierarchiesToInsert);
    }

    const unknownCount =
      hierarchyResult.classifications.length - hierarchiesToInsert.length;
    ctx.log.info(
      `Created ${hierarchiesToInsert.length} hierarchy records${unknownCount > 0 ? ` (skipped ${unknownCount} UNKNOWN)` : ''}`
    );

    return {
      bookId: book.id,
      hierarchiesCreated: hierarchiesToInsert.length
    };
  }
);

const ClassifyLocationSchema = Type.Object({
  id: Type.String({ description: 'The exact location id from the input' }),
  tier: Type.Number({
    minimum: 0,
    maximum: 4,
    description: 'Tier number: 0=Unknown, 1=Realm, 2=Hub, 3=Locale, 4=Micro'
  }),
  tier_label: Type.Union(
    [
      Type.Literal('Unknown'),
      Type.Literal('Realm'),
      Type.Literal('Hub'),
      Type.Literal('Locale'),
      Type.Literal('Micro')
    ],
    { description: 'Tier label; must agree with the numeric tier' }
  ),
  parent_id: Type.Union([Type.String(), Type.Null()], {
    description: 'Parent location id from the input, or null'
  }),
  reasoning: Type.String({
    description: 'Brief explanation for the classification'
  })
});

const EXPECTED_TIER_LABELS: Record<number, string> = {
  0: 'Unknown',
  1: 'Realm',
  2: 'Hub',
  3: 'Locale',
  4: 'Micro'
};

type Classification = {
  id: string;
  tier: number;
  tier_label: string;
  parent_id: string | null;
  reasoning: string;
};

async function extractHierarchy(
  {
    places,
    relationships
  }: {
    places: Array<{
      id: string;
      name: string;
      description: string | null;
      attributes: Array<{
        category: string;
        name: string;
        value: string;
        evidence: string;
      }>;
    }>;
    relationships: Array<{
      source_id: string;
      source_name: string;
      predicate: string;
      target_id: string;
      target_name: string;
      description: string;
    }>;
  },
  ctx: WorkflowContext
) {
  const validPlaceIds = new Set(places.map((p) => p.id));
  const classifiedMap = new Map<string, Classification>();

  const classifyLocationTool: AgentTool<typeof ClassifyLocationSchema> = {
    name: 'classify_location',
    label: 'Classify Location',
    description:
      'Set or update the hierarchy classification for a single location. Calling again for the same id overwrites the previous classification.',
    parameters: ClassifyLocationSchema,
    execute: async (_id, args) => {
      // Normalize parent_id: some agent paths send empty string or the literal "null" instead of JSON null
      const parentId =
        args.parent_id === null || args.parent_id === '' || args.parent_id === 'null'
          ? null
          : args.parent_id;

      if (!validPlaceIds.has(args.id)) {
        const sample = Array.from(validPlaceIds).slice(0, 20).join(', ');
        const msg = `Unknown location id "${args.id}". Must be one of the ids in the <locations> block (e.g. ${sample}${validPlaceIds.size > 20 ? ', ...' : ''}).`;
        ctx.log.warn(msg);
        throw new Error(msg);
      }

      const expectedLabel = EXPECTED_TIER_LABELS[args.tier];
      if (args.tier_label !== expectedLabel) {
        const msg = `tier_label "${args.tier_label}" does not match tier ${args.tier} (expected "${expectedLabel}").`;
        ctx.log.warn(msg);
        throw new Error(msg);
      }

      if (parentId !== null) {
        if (parentId === args.id) {
          const msg = `"${args.id}" cannot be its own parent. Use parent_id=null if there is no parent.`;
          ctx.log.warn(msg);
          throw new Error(msg);
        }
        if (!validPlaceIds.has(parentId)) {
          const msg = `Parent "${parentId}" is not a location in the input. Use null if no valid parent exists in the list.`;
          ctx.log.warn(msg);
          throw new Error(msg);
        }
        const parent = classifiedMap.get(parentId);
        if (!parent) {
          const msg = `Parent "${parentId}" has not been classified yet. Classify it first (top-down: Realms → Hubs → Locales → Micros), then classify "${args.id}".`;
          ctx.log.warn(msg);
          throw new Error(msg);
        }
        // Tier-strictly-less rule (skip when either side is Unknown=0)
        if (parent.tier !== 0 && args.tier !== 0 && parent.tier >= args.tier) {
          const msg = `Tier violation: "${args.id}" (tier ${args.tier} ${args.tier_label}) cannot have "${parentId}" (tier ${parent.tier} ${parent.tier_label}) as parent. A parent's tier number must be STRICTLY LESS than the child's. If both should be the same tier, set parent_id=null; if one functionally contains the other, reclassify the contained one as a Locale or Micro (city quarters/wards/districts are Locales, not Hubs).`;
          ctx.log.warn(msg);
          throw new Error(msg);
        }
      }

      // Reclassifying an existing parent must not invalidate its already-classified children
      for (const child of classifiedMap.values()) {
        if (child.parent_id !== args.id) continue;
        if (args.tier !== 0 && child.tier !== 0 && args.tier >= child.tier) {
          const msg = `Tier violation: setting "${args.id}" to tier ${args.tier} (${args.tier_label}) would invalidate its existing child "${child.id}" (tier ${child.tier} ${child.tier_label}). The parent's tier must be strictly less than each child's. Either pick a lower-numbered tier for "${args.id}" or re-parent its children first.`;
          ctx.log.warn(msg);
          throw new Error(msg);
        }
      }

      classifiedMap.set(args.id, {
        id: args.id,
        tier: args.tier,
        tier_label: args.tier_label,
        parent_id: parentId,
        reasoning: args.reasoning
      });

      ctx.log.info(
        `✓ Classified "${args.id}" as tier ${args.tier} (${args.tier_label})${parentId ? ` under "${parentId}"` : ''}`
      );

      return {
        content: [
          {
            type: 'text',
            text: `Classified "${args.id}" as tier ${args.tier} (${args.tier_label}).`
          }
        ],
        details: {}
      };
    }
  };

  const userText = extractHierarchyPrompt.render({ places, relationships });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [classifyLocationTool]
    },
    getApiKey: () => apiKey
  });

  watchAgent('extractHierarchy', agent, ctx);

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Extract hierarchy aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  const missingIds = places.filter((p) => !classifiedMap.has(p.id)).map((p) => p.id);
  if (missingIds.length > 0) {
    ctx.log.info(
      `${missingIds.length} locations were not classified, prompting for completion: ${missingIds.join(', ')}`
    );
    try {
      await agent.prompt(
        `You did not classify the following locations: ${missingIds.join(', ')}. Please call classify_location for each one. If you cannot determine a tier for a location, use tier=0 (Unknown) with parent_id=null.`
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        ctx.log.warn('Extract hierarchy aborted (completion pass)');
      } else {
        throw e;
      }
    }
  }

  const stillMissing = places.filter((p) => !classifiedMap.has(p.id)).map((p) => p.id);
  if (stillMissing.length > 0) {
    throw new RecoverableError(
      `Failed to classify ${stillMissing.length} locations after completion pass: ${stillMissing.join(', ')}`
    );
  }

  ctx.log.info(`Successfully classified ${classifiedMap.size} locations`);

  return {
    classifications: Array.from(classifiedMap.values())
  };
}

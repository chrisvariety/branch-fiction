import {
  getAttribute,
  extractWrappedXml,
  getText,
  parse,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { getDb } from '@/lib/db';
import { getBookArcsByBookIdAndTypesAndEntityIds } from '@/lib/db/models/book-arc/get-book-arc';
import { getBookEntityHierarchiesByBookId } from '@/lib/db/models/book-entity-hierarchy/get-book-entity-hierarchy';
import {
  getBookEntitiesByBookIdAndTypesAndSignificanceTiers,
  getBookEntitiesByIds
} from '@/lib/db/models/book-entity/get-book-entity';
import { updateBookEntityById } from '@/lib/db/models/book-entity/update-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { buildPlaceHierarchy } from '@/lib/lit/hierarchy';
import summarizePlaceIdentityTagPrompt from '@/lib/prompts/post-processing/summarize-place-identity-tag';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

// Percentage of data to include for identity tag generation (0-1)
const PLACE_ARC_PERCENTAGE = 0.75;

type Arc = { title: string; content: string };

export const handler = createWorkflowFunction<
  {
    bookId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
  },
  { bookId: string; placesUpdated: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Generate Identity Tags ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { book };
    },
    check: async (_payload, result) => ({
      passed: result.placesUpdated > 0,
      severity: 'WARN' as const,
      metadata: {
        placesUpdated: result.placesUpdated
      }
    })
  },
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting identity tag generation');

    await ctx.narrate('Simultaneously, doing the same for key places.');

    const placeResults = await generatePlaceIdentityTags(book, ctx);

    ctx.log.info(`Generated ${placeResults.updatedCount} place tags`);

    return {
      bookId: book.id,
      placesUpdated: placeResults.updatedCount
    };
  }
);

const PlaceIdentityTagOutputSchema = v.object({
  identity_tags: v.array(
    v.object({
      id: v.string(),
      identity_tag: v.string()
    })
  )
});

async function getPlaceArcsForIdentityTag(
  bookId: string,
  entityId: string
): Promise<Arc[]> {
  const arcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['PLACE'],
    [entityId]
  );

  if (arcs.length === 0) {
    return [];
  }

  // Take configured percentage of arcs (rounded up, minimum 1)
  const arcCount = Math.max(1, Math.ceil(arcs.length * PLACE_ARC_PERCENTAGE));
  return arcs.slice(0, arcCount).map((arc) => ({
    title: arc.title,
    content: arc.content
  }));
}

async function generatePlaceIdentityTags(
  book: { id: string; title: string },
  ctx: WorkflowContext
) {
  // Fetch PRIMARY places (these are the HUBs)
  const primaryPlaces = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
    book.id,
    ['PLACE'],
    ['PRIMARY']
  );

  if (primaryPlaces.length === 0) {
    ctx.log.info('No PRIMARY places found for identity tag generation');
    return { updatedCount: 0 };
  }

  ctx.log.info(`Found ${primaryPlaces.length} PRIMARY places (HUBs) for identity tags`);

  const hierarchies = await getBookEntityHierarchiesByBookId(book.id);

  // Build parent->children map for tier determination
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();
  const levelMap = new Map<string, string>();

  for (const hierarchy of hierarchies) {
    levelMap.set(hierarchy.bookEntityId, hierarchy.level);
    if (hierarchy.parentBookEntityId) {
      parentMap.set(hierarchy.bookEntityId, hierarchy.parentBookEntityId);
      const children = childrenMap.get(hierarchy.parentBookEntityId) || [];
      children.push(hierarchy.bookEntityId);
      childrenMap.set(hierarchy.parentBookEntityId, children);
    }
  }

  // Collect all identity tag results (outside transaction)
  const allIdentityTagResults: Array<{ entityId: string; identityTag: string }> = [];

  // Process each PRIMARY place (HUB) and its descendants
  for (const hubPlace of primaryPlaces) {
    // Build the hierarchy tree starting from this HUB
    const allPlaceEntityIds = buildPlaceHierarchy(hierarchies, hubPlace.id);

    if (allPlaceEntityIds.length === 0) {
      continue;
    }

    // Fetch entity data for all places in hierarchy
    const entities = await getBookEntitiesByIds(allPlaceEntityIds);
    const entityById = new Map(entities.map((e) => [e.id, e]));

    const placesForPrompt: Array<{
      friendlyId: string;
      name: string;
      arcs: Arc[];
      tier: 'HUB' | 'LOCALE' | 'MICRO';
      parentLocation?: string;
    }> = [];
    const placesMissingIdentityTag = new Set<string>(); // friendlyIds

    for (const entityId of allPlaceEntityIds) {
      const entity = entityById.get(entityId);
      if (!entity) {
        continue;
      }

      const arcs = await getPlaceArcsForIdentityTag(book.id, entityId);
      if (arcs.length === 0) {
        ctx.log.warn(`Place ${entity.name} has no arcs, skipping`);
        continue;
      }

      // Track if this place needs an identity tag
      if (!entity.identityTag) {
        placesMissingIdentityTag.add(entity.friendlyId);
      }

      // Determine tier based on hierarchy position
      const hasChildren = (childrenMap.get(entityId)?.length || 0) > 0;
      const hasParent = parentMap.has(entityId);
      const level = levelMap.get(entityId);

      let tier: 'HUB' | 'LOCALE' | 'MICRO';
      if (level === 'HUB' || (!hasParent && hasChildren)) {
        tier = 'HUB';
      } else if (hasChildren) {
        tier = 'LOCALE';
      } else {
        tier = 'MICRO';
      }

      // Get parent location name if exists
      const parentId = parentMap.get(entityId);
      const parentEntity = parentId ? entityById.get(parentId) : undefined;

      placesForPrompt.push({
        friendlyId: entity.friendlyId,
        name: entity.name,
        arcs,
        tier,
        parentLocation: parentEntity?.name
      });
    }

    // Skip if no places need identity tags
    if (placesMissingIdentityTag.size === 0) {
      ctx.log.info(
        `All places in ${hubPlace.name} hierarchy already have identity tags, skipping`
      );
      continue;
    }

    if (placesForPrompt.length === 0) {
      continue;
    }

    ctx.log.info(
      `Generating identity tags for ${placesMissingIdentityTag.size} places in ${hubPlace.name} hierarchy (${placesForPrompt.length} total for context)`
    );

    const identityTags = await generatePlaceIdentityTagsBatch(
      { places: placesForPrompt },
      ctx
    );

    // Map results to entity IDs, but only save for places that were missing identity tags
    const friendlyIdToId = new Map(entities.map((e) => [e.friendlyId, e.id]));

    for (const tag of identityTags) {
      // Only save identity tags for places that were missing them
      if (!placesMissingIdentityTag.has(tag.id)) {
        continue;
      }

      const entityId = friendlyIdToId.get(tag.id);
      if (!entityId) {
        ctx.log.warn(`Could not find entity for id: ${tag.id}`);
        continue;
      }
      allIdentityTagResults.push({ entityId, identityTag: tag.identity_tag });
    }
  }

  if (allIdentityTagResults.length > 0) {
    await getDb()
      .transaction()
      .execute(async (trx) => {
        for (const { entityId, identityTag } of allIdentityTagResults) {
          await updateBookEntityById(entityId, { identityTag }, trx);
        }
      });
  }

  return { updatedCount: allIdentityTagResults.length };
}

async function generatePlaceIdentityTagsBatch(
  {
    places
  }: {
    places: Array<{
      friendlyId: string;
      name: string;
      arcs: Arc[];
      tier: 'HUB' | 'LOCALE' | 'MICRO';
      parentLocation?: string;
    }>;
  },
  ctx: WorkflowContext
) {
  const userText = summarizePlaceIdentityTagPrompt.render({ places });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'generatePlaceIdentityTag',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, 'identity_tags');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new RecoverableError('No identity_tags found in response');
  }
  ctx.log.info(`Agent: captured <identity_tags> (length: ${xml.length})`);

  const ast = parse(xml);
  const tagNodes = querySelectorAll(ast, 'identity_tag');

  const data = {
    identity_tags: tagNodes.map((node) => ({
      id: getAttribute(node, 'id') || '',
      identity_tag: getText(node).trim()
    }))
  };

  const validatedData = v.safeParse(PlaceIdentityTagOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse identity tags: ${v.summarize(validatedData.issues)}`
    );
  }

  return validatedData.output.identity_tags;
}

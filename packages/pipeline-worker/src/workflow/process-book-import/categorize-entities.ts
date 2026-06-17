import { watchAgent } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { encode } from '@toon-format/toon';
import { v7 as uuidv7 } from 'uuid';

import type { BookEntity } from '@/app/lib/db/types';
import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getDb } from '@/lib/db';
import { getBookCategoriesByBookId } from '@/lib/db/models/book-category/get-book-category';
import { deleteBookEntityById } from '@/lib/db/models/book-entity/delete-book-entity';
import { getBookEntitiesByBookId } from '@/lib/db/models/book-entity/get-book-entity';
import { updateBookEntityById } from '@/lib/db/models/book-entity/update-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { normalizeName } from '@/lib/lit/names';
import categorizeEntitiesPrompt from '@/lib/prompts/import/categorize-entities';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type Logger,
  type WorkflowContext
} from '@/workflow/handler';

const UNCATEGORIZED = 'UNCATEGORIZED';

type Entity = {
  id: number;
  label: string;
  names: string[];
  description?: string;
  pronouns?: string;
  has_voice?: boolean;
  friendlyId?: string;
  type?: string;
};

const CategorizeAndIdentifyEntitySchema = Type.Object({
  entityId: Type.String({ description: 'The entity ID (e.g., "ent_123")' }),
  categorySlug: Type.String({
    description: 'The category slug (e.g., "CHARACTER", "PLACE")'
  }),
  identifier: Type.String({
    description:
      'A short, distinctive, unique identifier in snake_case (e.g., "silverhorne", "shadow_council")'
  })
});

const MergeEntitiesForCategorizationSchema = Type.Object({
  primary_entity_id: Type.String({
    description:
      'The entity ID to keep (e.g., "ent_456") - must already have category and identifier set'
  }),
  secondary_entity_id: Type.String({
    description: 'The entity ID to merge into primary (e.g., "ent_789")'
  }),
  label: Type.Optional(Type.String({ description: 'New label for merged entity' })),
  add_names: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Additional names to add beyond those from both entities'
    })
  ),
  description: Type.Optional(Type.String({ description: 'Replace description' })),
  pronouns: Type.Optional(Type.String({ description: 'Replace pronouns' })),
  has_voice: Type.Optional(Type.Boolean({ description: 'Replace has_voice value' }))
});

export const handler = createWorkflowFunction<
  {
    bookImportId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  }
>(
  {
    name: ({ book }, retryCount) =>
      `Categorize Entities ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookImportId }) => {
      const bookImport = await getBookImportById(bookImportId);
      if (!bookImport) throw new UnrecoverableError('Book Import not found');
      if (!bookImport.bookId) throw new UnrecoverableError('Book ID not found');
      const book = await getBookById(bookImport.bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      return { book, bookImport };
    },
    onFailure: async (_, error) => {
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({ bookId: book.id, bookTitle: book.title })
      .info('Starting entity categorization');

    const allEntities = await getBookEntitiesByBookId(book.id);
    const allCategories = await getBookCategoriesByBookId(book.id);

    if (!allCategories.length) {
      throw new UnrecoverableError(
        'No categories found for book, expected them to be extracted already'
      );
    }

    const uncategorizedCount = allEntities.filter((e) => e.type === UNCATEGORIZED).length;

    if (uncategorizedCount === 0) {
      ctx.log.info('All entities already categorized, nothing to do');
      return Response.json({ bookId: book.id, categorizedCount: 0 });
    }

    await ctx.narrate(
      `Sorting ${uncategorizedCount} ${uncategorizedCount === 1 ? 'entity' : 'entities'} into categories.`
    );

    const { surviving, deleted } = await categorizeEntities(
      { allEntities, allCategories },
      ctx
    );

    await getDb()
      .transaction()
      .execute(async (trx) => {
        for (const { dbId, update } of surviving) {
          await updateBookEntityById(dbId, update, trx);
        }
        for (const dbId of deleted) {
          await deleteBookEntityById(dbId, trx);
        }
      });

    const finalEntities = surviving.map(({ update }) => update);
    const charCount = finalEntities.filter((e) => e.type === 'CHARACTER').length;
    const placeCount = finalEntities.filter((e) => e.type === 'PLACE').length;
    const otherCount = finalEntities.length - charCount - placeCount;
    const parts = [
      charCount > 0 ? `${charCount} ${charCount === 1 ? 'character' : 'characters'}` : '',
      placeCount > 0 ? `${placeCount} ${placeCount === 1 ? 'place' : 'places'}` : '',
      otherCount > 0
        ? `${otherCount} other ${otherCount === 1 ? 'thing' : 'things'} of note`
        : ''
    ].filter(Boolean);
    if (parts.length > 0) {
      await ctx.narrate(parts.join(', ') + '.');
    }

    return Response.json({
      bookId: book.id,
      categorizedCount: surviving.length,
      deletedCount: deleted.length
    });
  }
);

type SurvivingUpdate = {
  dbId: string;
  update: {
    type: string;
    friendlyId: string;
    label: string | null;
    name: string;
    names: string[];
    description: string | null;
    pronouns: string | null;
    hasVoice: boolean;
  };
};

async function categorizeEntities(
  {
    allEntities,
    allCategories
  }: {
    allEntities: BookEntity[];
    allCategories: Awaited<ReturnType<typeof getBookCategoriesByBookId>>;
  },
  ctx: WorkflowContext
): Promise<{ surviving: SurvivingUpdate[]; deleted: string[] }> {
  ctx.log.info(`Loaded ${allEntities.length} entities for categorization`);

  // Map int IDs <-> DB UUIDs. Agent uses int IDs ("ent_123"); DB uses UUIDs.
  const entityMap = new Map<number, Entity>();
  const dbIdByIntId = new Map<number, string>();
  const nextEntityIdRef = { value: 1 };

  for (const dbEntity of allEntities) {
    const intId = nextEntityIdRef.value++;
    dbIdByIntId.set(intId, dbEntity.id);
    entityMap.set(intId, {
      id: intId,
      label: dbEntity.label || dbEntity.name,
      names: dbEntity.names,
      description: dbEntity.description ?? undefined,
      pronouns: dbEntity.pronouns ?? undefined,
      has_voice: dbEntity.hasVoice,
      friendlyId: dbEntity.friendlyId,
      type: dbEntity.type
    });
  }

  const originalDbIds = new Set(dbIdByIntId.values());

  // Seed categorizations with all entities that already have a real category.
  // Uses friendlyId stripped of the "pending_" prefix is invalid — we only treat real friendlyIds.
  const categorizations = new Map<number, { category: string; identifier: string }>();
  const remainingEntityIds: number[] = [];

  for (const [intId, entity] of entityMap.entries()) {
    if (entity.type && entity.type !== UNCATEGORIZED && entity.friendlyId) {
      categorizations.set(intId, {
        category: entity.type,
        identifier: entity.friendlyId
      });
      ctx.log.info(
        `✓ Pre-categorized "${entity.label}" as ${entity.type} (${entity.friendlyId})`
      );
    } else {
      remainingEntityIds.push(intId);
    }
  }

  ctx.log.info(
    `${remainingEntityIds.length} entities to categorize, ${categorizations.size} already done`
  );

  const MAX_CATEGORIZATION_ATTEMPTS = 15;
  let attempt = 0;
  let working = remainingEntityIds.slice();

  while (attempt < MAX_CATEGORIZATION_ATTEMPTS && working.length > 0) {
    attempt++;
    ctx.log.info(
      `Categorization attempt ${attempt}/${MAX_CATEGORIZATION_ATTEMPTS}: Processing ${working.length} entities`
    );

    const entitiesToProcess = working.map((id) => ({
      id,
      entity: entityMap.get(id)!
    }));

    const validCategorySlugs = new Set(allCategories.map((c) => c.type));

    const categorizeAndIdentifyEntityTool: AgentTool<
      typeof CategorizeAndIdentifyEntitySchema
    > = {
      name: 'categorize_and_identify_entity',
      label: 'Categorize Entity',
      description:
        'Categorize an entity into a specific category and assign it a unique identifier',
      parameters: CategorizeAndIdentifyEntitySchema,
      execute: async (_id, args) => {
        const entityId = parseInt(args.entityId.replace('ent_', ''));

        if (!validCategorySlugs.has(args.categorySlug)) {
          const validSlugs = Array.from(validCategorySlugs).join(', ');
          const errorMsg = `Invalid category slug "${args.categorySlug}" for entity ent_${entityId}. Valid categories: ${validSlugs}. Please try again with a valid category slug.`;
          ctx.log.warn(errorMsg);
          throw new Error(errorMsg);
        }

        const normalizedIdentifier = args.identifier
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');

        if (!normalizedIdentifier) {
          const errorMsg = `Identifier "${args.identifier}" for entity ent_${entityId} is empty after normalization. Please provide a valid snake_case identifier (e.g., "silverhorne", "shadow_council").`;
          ctx.log.warn(errorMsg);
          throw new Error(errorMsg);
        }

        for (const [existingId, existingCategorization] of categorizations.entries()) {
          if (existingId === entityId) continue;

          if (
            existingCategorization.identifier.toLowerCase().trim() ===
            normalizedIdentifier
          ) {
            const existingEntity = entityMap.get(existingId);
            const existingEntityEncoded = encode({
              ...existingEntity,
              id: `ent_${existingId}`,
              category: existingCategorization.category,
              identifier: existingCategorization.identifier
            });
            const errorMsg = `Identifier "${normalizedIdentifier}" is already used by entity ent_${existingId}.

Existing entity:
${existingEntityEncoded}

→ If these are the same entity: use merge_entities to combine them (compare labels, descriptions, etc.)
→ If different entities: retry with a unique identifier for entity ent_${entityId}`;
            ctx.log.warn(errorMsg);
            throw new Error(errorMsg);
          }
        }

        const entity = entityMap.get(entityId);
        const finalCategory = entity
          ? applyHasVoiceOverride(entity, args.categorySlug, ctx.log)
          : args.categorySlug;

        categorizations.set(entityId, {
          category: finalCategory,
          identifier: normalizedIdentifier
        });
        const entityLabel = entity?.label || `ent_${entityId}`;
        ctx.log.info(
          `✓ Categorized "${entityLabel}" as ${finalCategory} with identifier "${normalizedIdentifier}"`
        );
        return {
          content: [
            {
              type: 'text',
              text: `Successfully categorized entity ent_${entityId} as ${args.categorySlug} with identifier ${normalizedIdentifier}`
            }
          ],
          details: {}
        };
      }
    };

    const mergeEntitiesForCategorization: AgentTool<
      typeof MergeEntitiesForCategorizationSchema
    > = {
      name: 'merge_entities',
      label: 'Merge Entities',
      description: 'Merge two entities that turn out to be the same',
      parameters: MergeEntitiesForCategorizationSchema,
      execute: async (_id, args) => {
        const primaryId = parseInt(args.primary_entity_id.replace('ent_', ''));
        const secondaryId = parseInt(args.secondary_entity_id.replace('ent_', ''));

        const primaryEntity = entityMap.get(primaryId);
        const secondaryEntity = entityMap.get(secondaryId);

        if (!primaryEntity) {
          const errorMsg = `Primary entity ent_${primaryId} not found for merge. Please try again with a valid entity ID.`;
          ctx.log.warn(errorMsg);
          throw new Error(errorMsg);
        }
        if (!secondaryEntity) {
          const errorMsg = `Secondary entity ent_${secondaryId} not found for merge. Please try again with a valid entity ID.`;
          ctx.log.warn(errorMsg);
          throw new Error(errorMsg);
        }

        const primaryCategorization = categorizations.get(primaryId);
        if (!primaryCategorization) {
          const errorMsg = `Primary entity ent_${primaryId} must already be categorized. Please categorize it first before using it as a merge target.`;
          ctx.log.warn(errorMsg);
          throw new Error(errorMsg);
        }

        // Require at least one shared name when merging
        const primaryNormalized = new Set(primaryEntity.names.map(normalizeName));
        const sharedNames = secondaryEntity.names.filter((n) =>
          primaryNormalized.has(normalizeName(n))
        );
        if (sharedNames.length === 0) {
          const errorMsg = `Cannot merge ent_${primaryId} ("${primaryEntity.label}") and ent_${secondaryId} ("${secondaryEntity.label}") — they share no names. Distinct proper names almost always mean distinct entities, even when descriptions sound similar (e.g., two professors who teach the same subject are typically different people). Leave them as separate entities and categorize ent_${secondaryId} on its own.`;
          ctx.log.warn(errorMsg);
          throw new Error(errorMsg);
        }

        const mergedNames = Array.from(
          new Set([...primaryEntity.names, ...secondaryEntity.names])
        );
        if (args.add_names) {
          const cleanedNames = args.add_names.map((name) =>
            name.trim().replace(/[,.:;!?]+$/, '')
          );
          mergedNames.push(...cleanedNames);
        }

        primaryEntity.names = Array.from(new Set(mergedNames));
        if (args.label) primaryEntity.label = args.label;
        if (args.description) primaryEntity.description = args.description;
        else if (!primaryEntity.description)
          primaryEntity.description = secondaryEntity.description;
        if (args.pronouns) primaryEntity.pronouns = args.pronouns;
        else if (!primaryEntity.pronouns)
          primaryEntity.pronouns = secondaryEntity.pronouns;
        if (args.has_voice !== undefined) primaryEntity.has_voice = args.has_voice;
        else if (primaryEntity.has_voice === undefined)
          primaryEntity.has_voice = secondaryEntity.has_voice;

        entityMap.delete(secondaryId);
        categorizations.delete(secondaryId);

        ctx.log.info(
          `✓ Merged ent_${secondaryId} into ent_${primaryId}: ${primaryEntity.label} (${primaryCategorization.category}, ${primaryCategorization.identifier})`
        );
        return {
          content: [
            {
              type: 'text',
              text: `Successfully merged ent_${secondaryId} into ent_${primaryId}: ${primaryEntity.label}`
            }
          ],
          details: {}
        };
      }
    };

    const userText = categorizeEntitiesPrompt.render({
      categories: allCategories
        .filter((c) => c.type !== 'MENTIONED_INDIVIDUAL')
        .map((c) => ({
          name: c.name,
          slug: c.type,
          description: c.description
        })),
      entities: encode({
        entities: entitiesToProcess.map(({ id, entity }) => ({
          id: `ent_${id}`,
          label: entity.label,
          names: entity.names,
          description: entity.description,
          pronouns: entity.pronouns
        }))
      })
    });

    const { model, apiKey, reasoning } = ctx.getPiModel('piText');
    const agent = new Agent({
      sessionId: uuidv7(),
      initialState: {
        model,
        thinkingLevel: reasoning,
        tools: [categorizeAndIdentifyEntityTool, mergeEntitiesForCategorization]
      },
      getApiKey: () => apiKey
    });

    watchAgent('categorizeEntities', agent, ctx);

    try {
      await agent.prompt(userText);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        ctx.log.warn('Categorization aborted');
      } else {
        throw e;
      }
    }

    if (agent.state.errorMessage) {
      ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
    }

    const previousRemainingCount = working.length;
    working = working.filter((id) => entityMap.has(id) && !categorizations.has(id));

    const categorizedThisAttempt = previousRemainingCount - working.length;
    ctx.log.info(
      `Attempt ${attempt}: Categorized ${categorizedThisAttempt} entities. ${working.length} remaining.`
    );

    if (working.length > 0 && attempt < MAX_CATEGORIZATION_ATTEMPTS) {
      ctx.log.warn(
        `Retrying with ${working.length} uncategorized entities: ${working.map((id) => entityMap.get(id)?.label).join(', ')}`
      );
    }
  }

  ctx.log.info(
    `Categorization complete after ${attempt} attempt(s). ${categorizations.size} entities categorized total`
  );

  if (working.length > 0) {
    ctx.log.error(
      `Failed to categorize ${working.length} entities after ${MAX_CATEGORIZATION_ATTEMPTS} attempts: ${working.map((id) => entityMap.get(id)?.label).join(', ')}`
    );
    throw new RecoverableError(
      `Failed to categorize ${working.length} entities after ${MAX_CATEGORIZATION_ATTEMPTS} attempts`
    );
  }

  // Build the persistence plan: surviving updates + deleted dbIds (entities removed via merge).
  const surviving: SurvivingUpdate[] = [];
  const survivingDbIds = new Set<string>();

  for (const [intId, entity] of entityMap.entries()) {
    const dbId = dbIdByIntId.get(intId)!;
    survivingDbIds.add(dbId);

    const categorization = categorizations.get(intId);
    if (!categorization) {
      throw new RecoverableError(`No category assigned for entity: ${entity.label}`);
    }

    surviving.push({
      dbId,
      update: {
        type: categorization.category,
        friendlyId: categorization.identifier,
        label: entity.label,
        name: entity.label,
        names: entity.names,
        description: entity.description ?? null,
        pronouns: entity.pronouns ?? null,
        hasVoice: entity.has_voice ?? false
      }
    });
  }

  const deleted = [...originalDbIds].filter((dbId) => !survivingDbIds.has(dbId));

  return { surviving, deleted };
}

function applyHasVoiceOverride(
  entity: { label: string; has_voice?: boolean },
  categorySlug: string,
  log: Logger
): string {
  let finalCategory = categorySlug;

  if (entity.has_voice === true && categorySlug !== 'CHARACTER') {
    finalCategory = 'CHARACTER';
    log.info(
      `↻ Overriding "${entity.label}" from ${categorySlug} to CHARACTER (has_voice=true)`
    );
  } else if (categorySlug === 'CHARACTER' && entity.has_voice === false) {
    finalCategory = 'MENTIONED_INDIVIDUAL';
    log.info(
      `↻ Overriding "${entity.label}" from CHARACTER to MENTIONED_INDIVIDUAL (has_voice=false)`
    );
  }

  return finalCategory;
}

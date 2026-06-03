import { Agent } from '@earendil-works/pi-agent-core';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { createBookArcs } from '@/lib/db/models/book-arc/create-book-arc';
import {
  generateUniqueArcFriendlyPrefix,
  getBookArcsByBookIdAndTypesAndEntityIds
} from '@/lib/db/models/book-arc/get-book-arc';
import { getBookEntityHierarchiesByBookId } from '@/lib/db/models/book-entity-hierarchy/get-book-entity-hierarchy';
import {
  getBookEntitiesByIds,
  getBookEntityById
} from '@/lib/db/models/book-entity/get-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import {
  getChapterEntityAttributesByBookEntityIdAndCategories,
  getChapterEntityAttributesByBookEntityIds
} from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import {
  getChapterByBookIdAndChapterIdx,
  getMaxChapterIdxByBookId
} from '@/lib/db/models/chapter/get-chapter';
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import { parseChapterRange } from '@/lib/lit/chapter-range';
import { buildPlaceHierarchy, buildPlaceHierarchyPaths } from '@/lib/lit/hierarchy';
import { isolateArcs } from '@/lib/lit/isolate-arcs';
import {
  createLookupRelatedEntityAppearanceTool,
  getRelatedEntitiesFromArcs
} from '@/lib/lit/related-entities';
import { getAssistantText, watchAgent } from '@/lib/llm/agent';
import {
  getAttribute,
  extractWrappedXml,
  getInnerHtml,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@/lib/llm/xml';
import determineEntityArcPrompt from '@/lib/prompts/post-processing/determine-entity-arc';
import extractEntityAppearancePrompt from '@/lib/prompts/post-processing/extract-entity-appearance';
import extractEntityAppearanceArcPrompt from '@/lib/prompts/post-processing/extract-entity-appearance-arc';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

type Attributes =
  | Awaited<ReturnType<typeof getChapterEntityAttributesByBookEntityIds>>
  | Awaited<ReturnType<typeof getChapterEntityAttributesByBookEntityIdAndCategories>>;

type EntityWithAttributes = {
  id: string;
  friendlyId: string;
  name: string;
  type: string;
  attributes: Attributes;
};

export const handler = createWorkflowFunction<
  {
    bookEntityId: string;
    bookId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookEntity: NonNullable<Awaited<ReturnType<typeof getBookEntityById>>>;
  }
>(
  {
    name: ({ bookEntity }, retryCount) =>
      `Entity Appearance ${bookEntity.name}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, bookEntityId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      const bookEntity = await getBookEntityById(bookEntityId);
      if (!bookEntity) throw new UnrecoverableError('Book entity not found');
      if (bookEntity.bookId !== book.id)
        throw new UnrecoverableError('Book entity does not match book');
      return { book, bookEntity };
    }
  },
  async ({ book, bookEntity }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        bookEntityId: bookEntity.id,
        bookEntityName: bookEntity.name,
        bookEntityType: bookEntity.type
      })
      .info('Starting entity appearance extraction');

    let allEntitiesWithAttributes: EntityWithAttributes[] = [];

    if (bookEntity.type === 'PLACE') {
      const hierarchies = await getBookEntityHierarchiesByBookId(book.id);
      const entityIds = buildPlaceHierarchy(hierarchies, bookEntity.id);

      // Fetch all entities in the hierarchy
      const entities = entityIds.length ? await getBookEntitiesByIds(entityIds) : [];
      const entityIdToName = new Map(entities.map((e) => [e.id, e.name]));

      // Build hierarchical path strings for each place
      const placePaths = buildPlaceHierarchyPaths(hierarchies, entityIds, entityIdToName);

      const allAttributes = await getChapterEntityAttributesByBookEntityIds(entityIds);

      // Group attributes by entity ID
      const attributesByEntityId = new Map<string, Attributes>();
      for (const attr of allAttributes) {
        if (!attributesByEntityId.has(attr.bookEntityId)) {
          attributesByEntityId.set(attr.bookEntityId, []);
        }
        attributesByEntityId.get(attr.bookEntityId)!.push(attr);
      }

      // Build entities array with their attributes, using hierarchical paths as names
      allEntitiesWithAttributes = entities
        .map((entity) => ({
          id: entity.id,
          friendlyId: entity.friendlyId,
          name: placePaths[entity.id] || entity.name,
          type: entity.type,
          attributes: attributesByEntityId.get(entity.id) || []
        }))
        .filter((entity) => entity.attributes.length > 0);
    } else {
      // For non-PLACE entities, fetch attributes for the single entity that relate to Appearance
      const attributes = await getChapterEntityAttributesByBookEntityIdAndCategories(
        bookEntity.id,
        ['PHYSICAL', 'MAGICAL']
      );

      if (attributes.length) {
        allEntitiesWithAttributes = [
          {
            id: bookEntity.id,
            friendlyId: bookEntity.friendlyId,
            name: bookEntity.name,
            type: bookEntity.type,
            attributes
          }
        ];
      }
    }

    if (!allEntitiesWithAttributes.length) {
      ctx.log.info('Skipping appearance extraction - no entities with attributes found?');
      return Response.json({
        bookEntityIds: []
      });
    }

    // Check if appearance arcs already exist for any entities
    const existingArcResults = await getBookArcsByBookIdAndTypesAndEntityIds(
      book.id,
      ['APPEARANCE'],
      allEntitiesWithAttributes.map((entity) => entity.id)
    );

    // Filter out entities that already have arcs
    const existingArcEntityIds = new Set(
      existingArcResults.flatMap((result) => result.bookEntityIds)
    );
    const entitiesWithAttributes = allEntitiesWithAttributes.filter(
      (entity) => !existingArcEntityIds.has(entity.id)
    );

    // Early exit if all entities already have arcs
    if (entitiesWithAttributes.length === 0) {
      ctx.log.info(
        `Skipping appearance extraction - all ${allEntitiesWithAttributes.length} ${allEntitiesWithAttributes.length === 1 ? 'entity' : 'entities'} already have arcs`
      );
      return Response.json({
        bookEntityIds: []
      });
    }

    // Log if we filtered any
    if (existingArcEntityIds.size > 0) {
      ctx.log.info(
        `Filtered out ${existingArcEntityIds.size} ${existingArcEntityIds.size === 1 ? 'entity' : 'entities'} with existing arcs, processing ${entitiesWithAttributes.length} remaining`
      );
    }

    const appearances = await extractEntityAppearance(
      book.id,
      entitiesWithAttributes,
      ctx
    );

    // Group appearances by entityId (friendlyId)
    const appearancesByEntity = new Map<string, typeof appearances>();

    if (appearances.some((app) => app.entityId)) {
      // Multiple entities case - group by entityId
      for (const appearance of appearances) {
        if (!appearance.entityId) {
          throw new RecoverableError(
            'Expected entityId on all appearances when some have entityId'
          );
        }
        const existing = appearancesByEntity.get(appearance.entityId) || [];
        appearancesByEntity.set(appearance.entityId, [...existing, appearance]);
      }
    } else {
      // Single entity case - use first entity's friendlyId
      appearancesByEntity.set(entitiesWithAttributes[0].friendlyId, appearances);
    }

    // Log any entities missing from appearancesByEntity
    const missingEntities = entitiesWithAttributes.filter(
      (entity) => !appearancesByEntity.has(entity.friendlyId)
    );
    if (missingEntities.length > 0) {
      console.warn(
        `[extract-entity-appearance] Missing appearances for ${missingEntities.length} entities:`,
        missingEntities.map((e) => e.name)
      );
    }

    // Insert arcs for each entity group
    for (const [entityId, entityAppearances] of appearancesByEntity) {
      // Find the entity by friendlyId
      const entity = entitiesWithAttributes.find((e) => e.friendlyId === entityId);
      if (!entity) {
        throw new RecoverableError(`Entity with id '${entityId}' not found`);
      }

      // Generate friendly ID prefix for this specific entity
      const friendlyIdPrefix = await generateUniqueArcFriendlyPrefix({
        bookId: book.id,
        arcType: 'APPEARANCE',
        entityIds: [entity.id]
      });

      const createdArcs = await createBookArcs(
        entityAppearances.map((appearance) => ({
          id: uuidv7(),
          startChapterId: appearance.startChapterId,
          endChapterId: appearance.endChapterId,
          content: appearance.content,
          title: appearance.title,
          type: 'APPEARANCE' as const,
          bookId: book.id,
          bookEntityIds: [entity.id]
        })),
        friendlyIdPrefix
      );

      // Isolate arcs inline
      await isolateArcs(
        {
          arcType: 'APPEARANCE',
          arcs: createdArcs,
          bookId: book.id,
          bookTitle: book.title,
          entities: [{ name: entity.name, type: entity.type }]
        },
        ctx
      );
    }

    return Response.json({
      bookEntityIds: entitiesWithAttributes.map((entity) => entity.id)
    });
  }
);

async function extractEntityAppearance(
  bookId: string,
  entitiesWithAttributes: EntityWithAttributes[],
  ctx: WorkflowContext
) {
  // Combine text from all attributes for mention detection
  const attributesText = entitiesWithAttributes
    .flatMap((entity) =>
      entity.attributes.map((attr) => `${attr.name} ${attr.value} ${attr.evidence}`)
    )
    .join(' ');

  const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
    bookId,
    bookEntityIds: entitiesWithAttributes.map((e) => e.id),
    searchTextForMentions: attributesText
  });

  ctx.log.info(
    `Found ${relatedEntitiesResult.entities.length} related entities for appearance extraction`
  );

  // there's no need to run this for PLACE + their hierarchies, the prompt is already setup to return 1 or many arcs per place in the hierarchy
  const hasArc =
    entitiesWithAttributes.length > 1
      ? true
      : await determineEntityArc(entitiesWithAttributes[0], ctx);

  const maxChapterIdx = await getMaxChapterIdxByBookId(bookId);

  const appearances = hasArc
    ? await extractAppearanceArc(
        {
          entitiesWithAttributes,
          relatedEntities:
            relatedEntitiesResult.entities.length > 0
              ? relatedEntitiesResult.entities
              : undefined,
          contextEntityIds: relatedEntitiesResult.contextEntityIds,
          bookId,
          maxChapterIdx
        },
        ctx
      )
    : [
        await extractAppearance(
          {
            entitiesWithAttributes,
            relatedEntities:
              relatedEntitiesResult.entities.length > 0
                ? relatedEntitiesResult.entities
                : undefined,
            contextEntityIds: relatedEntitiesResult.contextEntityIds,
            bookId,
            maxChapterIdx
          },
          ctx
        )
      ];

  return appearances;
}

const DetermineOutputSchema = v.object({
  has_arc: v.boolean()
});

async function determineEntityArc(
  entityWithAttributes: EntityWithAttributes,
  ctx: WorkflowContext
) {
  const userText = determineEntityArcPrompt.render({
    attributes: entityWithAttributes.attributes,
    name: entityWithAttributes.name,
    type: entityWithAttributes.type
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'determineEntityArc',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, 'has_arc');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new RecoverableError('No has_arc found in response');
  }
  ctx.log.info(`Agent: captured <has_arc> (length: ${xml.length})`);

  const ast = parse(xml);

  const data = {
    has_arc: getText(querySelector(ast, 'has_arc')).trim() === 'true'
  };

  const parsedResult = v.parse(DetermineOutputSchema, data);

  return parsedResult.has_arc;
}

interface AppearanceInterface {
  entitiesWithAttributes: EntityWithAttributes[];
  relatedEntities?: {
    friendlyId: string;
    name: string;
    type: string;
    summary: string;
    phrasesUsed?: string;
  }[];
  contextEntityIds: string[];
  bookId: string;
  maxChapterIdx: number;
}

const SingleAppearanceOutputSchema = v.object({
  appearance: v.object({
    detail: v.pipe(
      v.string(),
      v.description('Complete standalone visual description in flowing prose')
    ),
    title: v.pipe(
      v.string(),
      v.description(
        "Narratively descriptive phrase capturing the essence of the entity's appearance"
      )
    )
  })
});

async function extractAppearance(
  {
    entitiesWithAttributes,
    relatedEntities,
    contextEntityIds,
    bookId,
    maxChapterIdx
  }: AppearanceInterface,
  ctx: WorkflowContext
) {
  const hasMultiple = entitiesWithAttributes.length > 1;

  if (hasMultiple)
    throw new UnrecoverableError(
      'Entity without arc prompt is not setup for multiple entities'
    );

  const userText = extractEntityAppearancePrompt.render({
    entity: entitiesWithAttributes[0],
    attributes: entitiesWithAttributes[0].attributes,
    relatedEntities: relatedEntities?.length ? relatedEntities : undefined
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [
        createLookupRelatedEntityAppearanceTool(bookId, contextEntityIds, 'appearance')
      ]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent('extractAppearance', agent, ctx, 'appearance');

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Extract entity appearance aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  if (!watcher.xml) {
    throw new UnrecoverableError('No appearance found in response');
  }

  const ast = parse(watcher.xml);
  const appearanceNode = querySelector(ast, 'appearance');

  if (!appearanceNode) {
    throw new UnrecoverableError(
      `No appearance element found in response: ${watcher.xml}`
    );
  }

  const data = {
    appearance: {
      detail: getInnerHtml(querySelector(appearanceNode, 'detail')).trim(),
      title: getText(querySelector(appearanceNode, 'title')).trim()
    }
  };

  const validatedData = v.safeParse(SingleAppearanceOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse appearance: ${v.summarize(validatedData.issues)}`
    );
  }

  // Get first and last chapters since this appearance spans the whole book
  const startChapter = await getChapterByBookIdAndChapterIdx(bookId, 1);
  const endChapter = await getChapterByBookIdAndChapterIdx(bookId, maxChapterIdx);

  if (!startChapter || !endChapter) {
    throw new RecoverableError(`Could not find first or last chapter for book ${bookId}`);
  }

  // Extract entityId from id attribute if multiple entities
  const entityId = hasMultiple ? getAttribute(appearanceNode, 'id')?.trim() : undefined;

  return {
    startChapterId: startChapter.id,
    endChapterId: endChapter.id,
    content: validatedData.output.appearance.detail,
    title: validatedData.output.appearance.title,
    entityId
  };
}

const ArcOutputSchema = v.object({
  appearances: v.pipe(
    v.array(
      v.object({
        chapters: v.pipe(
          v.string(),
          v.description(
            'Chapter range where this appearance phase occurs (e.g., "1-5", "6+")'
          )
        ),
        detail: v.pipe(
          v.string(),
          v.description(
            'Complete standalone visual description for this phase in flowing prose'
          )
        ),
        title: v.pipe(
          v.string(),
          v.description(
            'Narratively descriptive phrase capturing the essence of the appearance in this phase'
          )
        )
      })
    ),
    v.description(
      "Sequential phases of the entity's appearance transformation throughout the story"
    )
  )
});

const ArcsOutputSchema = v.object({
  entity_arcs: v.pipe(
    v.array(
      v.object({
        entity_id: v.pipe(
          v.string(),
          v.description('ID of the entity this arc belongs to')
        ),
        appearances: v.pipe(
          v.array(
            v.object({
              chapters: v.pipe(
                v.string(),
                v.description(
                  'Chapter range where this appearance phase occurs (e.g., "1-5", "6-end")'
                )
              ),
              detail: v.pipe(
                v.string(),
                v.description(
                  'Complete standalone visual description for this phase in flowing prose'
                )
              ),
              title: v.pipe(
                v.string(),
                v.description(
                  'Narratively descriptive phrase capturing the essence of the appearance in this phase'
                )
              )
            })
          ),
          v.description("Sequential phases of this entity's appearance transformation")
        )
      })
    ),
    v.description(
      'Appearance arcs for multiple entities, each with their own transformation phase or phases'
    )
  )
});

async function extractAppearanceArc(
  {
    entitiesWithAttributes,
    relatedEntities,
    contextEntityIds,
    bookId,
    maxChapterIdx
  }: AppearanceInterface,
  ctx: WorkflowContext
) {
  const hasMultiple = entitiesWithAttributes.length > 1;
  const wrapperTag = hasMultiple ? 'entity_arcs' : 'appearances';

  const userText = extractEntityAppearanceArcPrompt.render({
    firstEntity: entitiesWithAttributes[0],
    entities: entitiesWithAttributes,
    relatedEntities: relatedEntities?.length ? relatedEntities : undefined
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [
        createLookupRelatedEntityAppearanceTool(bookId, contextEntityIds, 'appearance')
      ]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent('extractAppearanceArc', agent, ctx, wrapperTag);

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Extract entity appearance arc aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  if (!watcher.xml) {
    throw new UnrecoverableError('No appearances found in response');
  }

  const ast = parse(watcher.xml);

  // Extract and validate based on schema type
  let output: Array<{
    chapters: string;
    detail: string;
    title: string;
    entityId?: string;
  }> = [];

  if (hasMultiple) {
    // Use ArcsOutputSchema for multiple non-character entities
    const entityNodes = querySelectorAll(ast, 'entity');
    const data = {
      entity_arcs: entityNodes.map((entity) => ({
        entity_id: getAttribute(entity, 'id')?.trim() || '',
        appearances: querySelectorAll(entity, 'appearances > appearance').map(
          (appearance) => ({
            chapters: getText(querySelector(appearance, 'chapters')).trim(),
            detail: getInnerHtml(querySelector(appearance, 'detail')).trim(),
            title: getText(querySelector(appearance, 'title')).trim()
          })
        )
      }))
    };

    const validatedData = v.safeParse(ArcsOutputSchema, data);

    if (!validatedData.success) {
      ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
      throw new RecoverableError(
        `Failed to parse entity arcs: ${v.summarize(validatedData.issues)}`
      );
    }

    if (validatedData.output.entity_arcs.length === 0) {
      throw new RecoverableError('No entity arcs found in response');
    }

    output = validatedData.output.entity_arcs.flatMap((entityArc) =>
      entityArc.appearances.map((appearance) => ({
        ...appearance,
        entityId: entityArc.entity_id
      }))
    );
  } else {
    // Use ArcOutputSchema for single entity or character
    const appearanceNodes = querySelectorAll(ast, 'appearance');
    const data = {
      appearances: appearanceNodes.map((appearance) => ({
        chapters: getText(querySelector(appearance, 'chapters')).trim(),
        detail: getInnerHtml(querySelector(appearance, 'detail')).trim(),
        title: getText(querySelector(appearance, 'title')).trim()
      }))
    };

    const validatedData = v.safeParse(ArcOutputSchema, data);

    if (!validatedData.success) {
      ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
      throw new RecoverableError(
        `Failed to parse appearances: ${v.summarize(validatedData.issues)}`
      );
    }

    if (validatedData.output.appearances.length === 0) {
      throw new RecoverableError('No appearances found in response');
    }

    output = validatedData.output.appearances;
  }

  const mappedData: {
    startChapterId: string;
    endChapterId: string;
    content: string;
    title: string;
    entityId?: string;
  }[] = [];

  for (const appearance of output) {
    const chapterRange = parseChapterRange(appearance.chapters, maxChapterIdx);

    const startChapter = await getChapterByBookIdAndChapterIdx(
      bookId,
      chapterRange.startChapterIdx
    );
    const endChapter = await getChapterByBookIdAndChapterIdx(
      bookId,
      chapterRange.endChapterIdx
    );

    if (!startChapter || !endChapter) {
      throw new RecoverableError(
        `Could not find chapters for range ${appearance.chapters} (${chapterRange.startChapterIdx}-${chapterRange.endChapterIdx})`
      );
    }

    mappedData.push({
      startChapterId: startChapter.id,
      endChapterId: endChapter.id,
      content: appearance.detail,
      title: appearance.title,
      entityId: appearance.entityId
    });
  }

  return mappedData;
}

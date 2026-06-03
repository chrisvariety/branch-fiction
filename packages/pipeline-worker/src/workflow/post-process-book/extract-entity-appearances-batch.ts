import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { createBookArcs } from '@/lib/db/models/book-arc/create-book-arc';
import {
  generateUniqueArcFriendlyPrefix,
  getBookArcsByBookIdAndTypesAndEntityIds
} from '@/lib/db/models/book-arc/get-book-arc';
import { getBookEntityNamesByBookIdsAndNotTypesAndSignificanceTiers } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getChapterEntityAttributesByBookEntityIdsAndCategories } from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import {
  getChapterByBookIdAndChapterIdx,
  getMaxChapterIdxByBookId
} from '@/lib/db/models/chapter/get-chapter';
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import { parseChapterRange } from '@/lib/lit/chapter-range';
import { isolateArcs } from '@/lib/lit/isolate-arcs';
import { getAssistantText } from '@/lib/llm/agent';
import {
  getAttribute,
  extractWrappedXml,
  getInnerHtml,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@/lib/llm/xml';
import extractMultipleEntitiesAppearanceArcsPrompt from '@/lib/prompts/post-processing/extract-multiple-entities-appearance-arcs';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

type Attributes = Awaited<
  ReturnType<typeof getChapterEntityAttributesByBookEntityIdsAndCategories>
>;

type EntityWithAttributes = {
  id: string;
  friendlyId: string;
  name: string;
  type: string;
  description?: string;
  attributes: Attributes;
};

const BATCH_SIZE = 15;

export const handler = createWorkflowFunction<
  {
    bookId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
  },
  { bookEntityIds: string[] }
>(
  {
    name: ({ book }, retryCount) =>
      `Batch Entity Appearances ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      return { book };
    },
    check: async (_payload, result) => ({
      passed: result.bookEntityIds.length >= 0,
      severity: 'WARN' as const,
      metadata: { entitiesProcessed: result.bookEntityIds.length }
    })
  },
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({ bookId: book.id, bookTitle: book.title })
      .info('Starting batch entity appearance extraction');

    // Get all non-CHARACTER, non-PLACE entities with PRIMARY or SECONDARY significance
    const entities = await getBookEntityNamesByBookIdsAndNotTypesAndSignificanceTiers(
      [book.id],
      ['CHARACTER', 'PLACE'],
      ['PRIMARY', 'SECONDARY']
    );

    if (!entities.length) {
      ctx.log.info('No eligible entities found for batch appearance extraction');
      return { bookEntityIds: [] };
    }

    // Get PHYSICAL and MAGICAL attributes for all entities in one query
    const allAttributes = await getChapterEntityAttributesByBookEntityIdsAndCategories(
      entities.map((e) => e.id),
      ['PHYSICAL', 'MAGICAL']
    );

    // Group attributes by entity ID
    const attributesByEntityId = new Map<string, Attributes>();
    for (const attr of allAttributes) {
      if (!attributesByEntityId.has(attr.bookEntityId)) {
        attributesByEntityId.set(attr.bookEntityId, []);
      }
      attributesByEntityId.get(attr.bookEntityId)!.push(attr);
    }

    // Build entities with attributes, filter out those with none
    const allEntitiesWithAttributes: EntityWithAttributes[] = entities
      .map((entity) => ({
        id: entity.id,
        friendlyId: entity.friendlyId,
        name: entity.name,
        type: entity.type,
        description: entity.description ?? undefined,
        attributes: attributesByEntityId.get(entity.id) || []
      }))
      .filter((entity) => entity.attributes.length > 0);

    if (!allEntitiesWithAttributes.length) {
      ctx.log.info('No entities with attributes found for batch appearance extraction');
      return { bookEntityIds: [] };
    }

    await ctx.narrate('Simultaneously, figuring out what everything looks like.');

    // Filter out entities that already have appearance arcs
    const existingArcResults = await getBookArcsByBookIdAndTypesAndEntityIds(
      book.id,
      ['APPEARANCE'],
      allEntitiesWithAttributes.map((e) => e.id)
    );

    const existingArcEntityIds = new Set(
      existingArcResults.flatMap((result) => result.bookEntityIds)
    );

    const entitiesToProcess = allEntitiesWithAttributes.filter(
      (entity) => !existingArcEntityIds.has(entity.id)
    );

    if (!entitiesToProcess.length) {
      ctx.log.info(
        `All ${allEntitiesWithAttributes.length} entities already have appearance arcs`
      );
      return { bookEntityIds: [] };
    }

    if (existingArcEntityIds.size > 0) {
      ctx.log.info(
        `Filtered out ${existingArcEntityIds.size} entities with existing arcs, processing ${entitiesToProcess.length} remaining`
      );
    }

    const maxChapterIdx = await getMaxChapterIdxByBookId(book.id);
    const processedEntityIds: string[] = [];

    // Process in batches
    for (let i = 0; i < entitiesToProcess.length; i += BATCH_SIZE) {
      const batch = entitiesToProcess.slice(i, i + BATCH_SIZE);

      ctx.log.info(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(entitiesToProcess.length / BATCH_SIZE)} (${batch.length} entities)`
      );

      const appearances = await extractBatchAppearances(
        book.id,
        batch,
        maxChapterIdx,
        ctx
      );

      // Group appearances by entityId (friendlyId)
      const appearancesByEntity = new Map<string, typeof appearances>();
      for (const appearance of appearances) {
        if (!appearance.entityId) {
          throw new RecoverableError('Expected entityId on all appearances');
        }
        const existing = appearancesByEntity.get(appearance.entityId) || [];
        appearancesByEntity.set(appearance.entityId, [...existing, appearance]);
      }

      // Log any entities missing from the response
      const missingEntities = batch.filter(
        (entity) => !appearancesByEntity.has(entity.friendlyId)
      );
      if (missingEntities.length > 0) {
        console.warn(
          `[extract-entity-appearances-batch] Missing appearances for ${missingEntities.length} entities:`,
          missingEntities.map((e) => e.name)
        );
      }

      // Create arcs for each entity
      for (const [entityId, entityAppearances] of appearancesByEntity) {
        const entity = batch.find((e) => e.friendlyId === entityId);
        if (!entity) {
          throw new RecoverableError(`Entity with id '${entityId}' not found in batch`);
        }

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

        processedEntityIds.push(entity.id);
      }
    }

    return { bookEntityIds: processedEntityIds };
  }
);

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

async function extractBatchAppearances(
  bookId: string,
  batch: EntityWithAttributes[],
  maxChapterIdx: number,
  ctx: WorkflowContext
) {
  const userText = extractMultipleEntitiesAppearanceArcsPrompt.render({
    entities: batch.map((entity) => ({
      friendlyId: entity.friendlyId,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      attributes: entity.attributes
    }))
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'extractBatchAppearances',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, 'entity_arcs');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new UnrecoverableError('No entity_arcs found in response');
  }
  ctx.log.info(`Agent: captured <entity_arcs> (length: ${xml.length})`);

  const ast = parse(xml);
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

  const mappedData: {
    startChapterId: string;
    endChapterId: string;
    content: string;
    title: string;
    entityId: string;
  }[] = [];

  for (const entityArc of validatedData.output.entity_arcs) {
    for (const appearance of entityArc.appearances) {
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
        entityId: entityArc.entity_id
      });
    }
  }

  return mappedData;
}

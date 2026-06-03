import { Agent } from '@earendil-works/pi-agent-core';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { NewBookArc } from '@/app/lib/db/types';
import { getDb } from '@/lib/db';
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
import { getChapterEntityAttributesByBookEntityIds } from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import { getChapterRelationshipsWithChapterAndEntitiesByBookId } from '@/lib/db/models/chapter-relationship/get-chapter-relationship';
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
import { watchAgent } from '@/lib/llm/agent';
import { getText, parse, querySelector, querySelectorAll } from '@/lib/llm/xml';
import extractPlaceArcPrompt from '@/lib/prompts/post-processing/extract-place-arc';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

export const handler = createWorkflowFunction<
  {
    bookId: string;
    // IDs here should be (generally) "HUB" level (which are auto-selected as PRIMARY when available), we'll automatically go to all of the descendants
    bookEntityId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookEntity: NonNullable<Awaited<ReturnType<typeof getBookEntityById>>>;
  }
>(
  {
    name: ({ bookEntity }, retryCount) =>
      `Extract Place Arc ${bookEntity.name}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, bookEntityId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      const bookEntity = await getBookEntityById(bookEntityId);
      if (!bookEntity) throw new UnrecoverableError('Book entity not found');
      if (bookEntity.bookId !== book.id)
        throw new UnrecoverableError('Book entity does not match book');
      if (bookEntity.type !== 'PLACE')
        throw new UnrecoverableError('Book entity is not a place');

      return { book, bookEntity };
    }
  },
  async ({ book, bookEntity }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        bookEntityId: bookEntity.id,
        bookEntityName: bookEntity.name
      })
      .info('Starting place arc extraction');

    // Fetch all hierarchies for the book
    const hierarchies = await getBookEntityHierarchiesByBookId(book.id);

    // Build the hierarchy tree starting from the given entity
    const allPlaceEntityIds = buildPlaceHierarchy(hierarchies, bookEntity.id);

    if (allPlaceEntityIds.length === 0) {
      ctx.log.info('No place hierarchy found for place arc extraction');
      return Response.json({
        bookEntityId: bookEntity.id,
        arcsCreated: 0
      });
    }

    // Check if place arcs already exist for any places in the hierarchy
    const existingArcResults = await getBookArcsByBookIdAndTypesAndEntityIds(
      book.id,
      ['PLACE'],
      allPlaceEntityIds
    );

    // Filter out places that already have arcs
    const existingArcEntityIds = new Set(
      existingArcResults.flatMap((result) => result.bookEntityIds)
    );
    const placeEntityIds = allPlaceEntityIds.filter(
      (id) => !existingArcEntityIds.has(id)
    );

    if (placeEntityIds.length === 0) {
      ctx.log.info(
        `Skipping place arc extraction - all ${allPlaceEntityIds.length} places already have arcs`
      );
      return Response.json({
        bookEntityId: bookEntity.id,
        arcsCreated: 0
      });
    }

    if (existingArcEntityIds.size > 0) {
      ctx.log.info(
        `Filtered out ${existingArcEntityIds.size} places with existing arcs, processing ${placeEntityIds.length} remaining places`
      );
    }

    // Fetch entity data for building paths
    const entities = await getBookEntitiesByIds(placeEntityIds);
    const entityIdToName = new Map(entities.map((e) => [e.id, e.name]));
    const entityIdToFriendlyId = new Map(entities.map((e) => [e.id, e.friendlyId]));

    // Build hierarchical path strings for each place
    const placePaths = buildPlaceHierarchyPaths(
      hierarchies,
      placeEntityIds,
      entityIdToName
    );

    ctx.log.info(
      `Found ${placeEntityIds.length} places in hierarchy: ${Object.values(placePaths).join(', ')}`
    );

    // Fetch attributes for all places in the hierarchy
    const attributes = await getChapterEntityAttributesByBookEntityIds(placeEntityIds);

    ctx.log.info(`Found ${attributes.length} place attributes to analyze`);

    // Fetch all relationships for the book
    const allRelationships = (
      await getChapterRelationshipsWithChapterAndEntitiesByBookId(book.id)
    ).sort((a, b) => a.chapter.idx - b.chapter.idx);

    ctx.log.info(`Found ${allRelationships.length} relationships to analyze`);

    const placeEntityIdSet = new Set(placeEntityIds);
    const relevantRelationships = allRelationships.filter(
      (rel) =>
        (placeEntityIdSet.has(rel.sourceEntity.id) ||
          placeEntityIdSet.has(rel.targetEntity.id)) &&
        rel.sourceEntity.type !== 'CHARACTER' &&
        rel.targetEntity.type !== 'CHARACTER'
    );

    ctx.log.info(
      `Found ${relevantRelationships.length} relationships involving the selected places`
    );

    const relationships = relevantRelationships.map(
      (rel) =>
        `(${rel.sourceEntity.friendlyId})-[:${rel.predicateType} {chapter: ${rel.chapter.idx}, description: "${rel.predicateDescription}"}]->(${rel.targetEntity.friendlyId})`
    );

    // Combine text from attributes and relationships for mention detection
    const attributesText = attributes
      .map((attr) => `${attr.name} ${attr.value} ${attr.evidence}`)
      .join(' ');
    const relationshipsText = relationships.join(' ');
    const combinedText = `${attributesText} ${relationshipsText}`;

    const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
      bookId: book.id,
      bookEntityIds: placeEntityIds,
      searchTextForMentions: combinedText
    });

    ctx.log.info(
      `Found ${relatedEntitiesResult.entities.length} related entities for place arc extraction`
    );

    const maxChapterIdx = await getMaxChapterIdxByBookId(book.id);

    // Build places array with friendlyId and name (path)
    const placesWithIds = Object.entries(placePaths).map(([entityId, path]) => ({
      friendlyId: entityIdToFriendlyId.get(entityId) || entityId,
      name: path
    }));

    const placeArcResult = await extractPlaceArc(
      {
        book,
        places: placesWithIds,
        attributes: attributes.map((attr) => ({
          location: placePaths[attr.bookEntityId] || 'Unknown',
          chapterIdx: attr.chapterIdx,
          category: attr.category,
          name: attr.name,
          value: attr.value,
          evidence: attr.evidence
        })),
        relationships,
        relatedEntities:
          relatedEntitiesResult.entities.length > 0
            ? relatedEntitiesResult.entities
            : undefined,
        contextEntityIds: relatedEntitiesResult.contextEntityIds,
        maxChapterIdx
      },
      ctx
    );

    ctx.log.info(`Generated ${placeArcResult.length} place arc snapshots`);

    // Create a map from friendlyId to entity IDs
    const locationToEntityIds = new Map<string, string[]>();
    for (const entityId of Object.keys(placePaths)) {
      const friendlyId = entityIdToFriendlyId.get(entityId);
      if (friendlyId) {
        locationToEntityIds.set(friendlyId, [entityId]);
      }
    }

    // Create book arcs and link to involved places
    const arcsToInsert: Array<
      Omit<NewBookArc, 'friendlyIdPrefix' | 'friendlyId' | 'friendlyIdIdx'>
    > = [];

    for (const arc of placeArcResult) {
      // Map location to entity IDs
      const entityIds = locationToEntityIds.get(arc.location) || [];

      if (entityIds.length === 0) {
        throw new RecoverableError(
          `Could not find entity IDs for location: ${arc.location}`
        );
      }

      arcsToInsert.push({
        id: uuidv7(),
        bookId: book.id,
        type: 'PLACE',
        startChapterId: arc.startChapterId,
        endChapterId: arc.endChapterId,
        title: arc.title,
        content: arc.content,
        bookEntityIds: entityIds
      });
    }

    // Group arcs by entity IDs to batch insert with same prefix
    const arcsByEntityIds = new Map<string, typeof arcsToInsert>();
    for (const arc of arcsToInsert) {
      const key = arc.bookEntityIds.sort().join(',');
      if (!arcsByEntityIds.has(key)) {
        arcsByEntityIds.set(key, []);
      }
      arcsByEntityIds.get(key)!.push(arc);
    }

    // Insert arcs and link to places in a transaction
    const createdArcs = await getDb()
      .transaction()
      .execute(async (trx) => {
        const allArcs: Awaited<ReturnType<typeof createBookArcs>> = [];

        // Process each group of arcs with the same entity IDs
        for (const arcsGroup of arcsByEntityIds.values()) {
          // Generate prefix for this group
          const friendlyIdPrefix = await generateUniqueArcFriendlyPrefix({
            bookId: book.id,
            arcType: 'PLACE',
            entityIds: arcsGroup[0].bookEntityIds,
            trx
          });

          const arcs = await createBookArcs(arcsGroup, friendlyIdPrefix, trx);

          allArcs.push(...arcs);
        }

        return allArcs;
      });

    ctx.log.info(`Created ${createdArcs.length} place arc snapshots`);

    // Isolate arcs inline — group by friendlyIdPrefix since each entity group has its own
    const arcsByPrefix = new Map<string, typeof createdArcs>();
    for (const arc of createdArcs) {
      const existing = arcsByPrefix.get(arc.friendlyIdPrefix) || [];
      existing.push(arc);
      arcsByPrefix.set(arc.friendlyIdPrefix, existing);
    }
    for (const groupArcs of arcsByPrefix.values()) {
      await isolateArcs(
        {
          arcType: 'PLACE',
          arcs: groupArcs,
          bookId: book.id,
          bookTitle: book.title,
          entities: [{ name: bookEntity.name, type: 'PLACE' }]
        },
        ctx
      );
    }

    return Response.json({
      bookEntityId: bookEntity.id,
      arcsCreated: createdArcs.length
    });
  }
);

const PlaceArcOutputSchema = v.object({
  snapshots: v.array(
    v.object({
      location: v.string(),
      phase: v.string(),
      chapters: v.string(),
      detail: v.string()
    })
  )
});

async function extractPlaceArc(
  {
    book,
    places,
    attributes,
    relationships,
    relatedEntities,
    contextEntityIds,
    maxChapterIdx
  }: {
    book: { id: string; title: string };
    places: { friendlyId: string; name: string }[];
    attributes: Array<{
      location: string;
      chapterIdx: number;
      category: string;
      name: string;
      value: string;
      evidence: string;
    }>;
    relationships: string[];
    relatedEntities?: {
      friendlyId: string;
      name: string;
      type: string;
      summary: string;
      phrasesUsed?: string;
    }[];
    contextEntityIds: string[];
    maxChapterIdx: number;
  },
  ctx: WorkflowContext
) {
  const userText = extractPlaceArcPrompt.render({
    places,
    attributes,
    relationships,
    relatedEntities
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [
        createLookupRelatedEntityAppearanceTool(book.id, contextEntityIds, 'general')
      ]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent('extractPlaceArc', agent, ctx, 'snapshots');

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Extract place arc aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  if (!watcher.xml) {
    throw new UnrecoverableError('No snapshots found in response');
  }

  const ast = parse(watcher.xml);
  const snapshotNodes = querySelectorAll(ast, 'snapshot');

  const data = {
    snapshots: snapshotNodes.map((snapshot) => ({
      location: getText(querySelector(snapshot, 'location')).trim(),
      phase: getText(querySelector(snapshot, 'phase')).trim(),
      chapters: getText(querySelector(snapshot, 'chapters')).trim(),
      detail: getText(querySelector(snapshot, 'detail')).trim()
    }))
  };

  const validatedData = v.safeParse(PlaceArcOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse place arc snapshots: ${v.summarize(validatedData.issues)}`
    );
  }

  if (validatedData.output.snapshots.length === 0) {
    throw new RecoverableError('No snapshots found in response');
  }

  const mappedData: {
    location: string;
    startChapterId: string;
    endChapterId: string;
    content: string;
    title: string;
  }[] = [];

  for (const snapshot of validatedData.output.snapshots) {
    const chapterRange = parseChapterRange(snapshot.chapters, maxChapterIdx);

    const startChapter = await getChapterByBookIdAndChapterIdx(
      book.id,
      chapterRange.startChapterIdx
    );
    const endChapter = await getChapterByBookIdAndChapterIdx(
      book.id,
      chapterRange.endChapterIdx
    );

    if (!startChapter || !endChapter) {
      throw new RecoverableError(
        `Could not find chapters for range ${snapshot.chapters} (${chapterRange.startChapterIdx}-${chapterRange.endChapterIdx})`
      );
    }

    mappedData.push({
      location: snapshot.location,
      startChapterId: startChapter.id,
      endChapterId: endChapter.id,
      content: snapshot.detail,
      title: snapshot.phase
    });
  }

  return mappedData;
}

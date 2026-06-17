import {
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { watchAgent } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { Agent } from '@earendil-works/pi-agent-core';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { createBookArcs } from '@/lib/db/models/book-arc/create-book-arc';
import {
  generateUniqueArcFriendlyPrefix,
  getBookArcsByBookIdAndTypesAndEntityIds
} from '@/lib/db/models/book-arc/get-book-arc';
import { getBookEntityById } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getChapterEntityAttributesByBookEntityId } from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import { getChapterRelationshipsWithChapterAndEntitiesByBookId } from '@/lib/db/models/chapter-relationship/get-chapter-relationship';
import {
  getChapterByBookIdAndChapterIdx,
  getChapterById,
  getMaxChapterIdxByBookId
} from '@/lib/db/models/chapter/get-chapter';
import { parseChapterRange } from '@/lib/lit/chapter-range';
import { isolateArcs } from '@/lib/lit/isolate-arcs';
import {
  createLookupRelatedEntityAppearanceTool,
  getRelatedEntitiesFromArcs
} from '@/lib/lit/related-entities';
import extractCharacterArcPrompt from '@/lib/prompts/post-processing/extract-character-arc';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

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
      `Extract Character Arc ${bookEntity.name}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, bookEntityId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      const bookEntity = await getBookEntityById(bookEntityId);
      if (!bookEntity) throw new UnrecoverableError('Book entity not found');
      if (bookEntity.bookId !== book.id)
        throw new UnrecoverableError('Book entity does not match book');
      if (bookEntity.type !== 'CHARACTER')
        throw new UnrecoverableError('Book entity is not a character');

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
      .info('Starting character arc extraction');

    // Check if character arcs already exist
    const existingArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
      book.id,
      ['CHARACTER'],
      [bookEntity.id]
    );
    if (existingArcs.length > 0) {
      ctx.log.info(
        `Skipping character arc extraction - ${existingArcs.length} arcs already exist for ${bookEntity.name}`
      );
      return Response.json({
        bookEntityId: bookEntity.id,
        arcsCreated: 0
      });
    }

    // Fetch all character attributes
    const attributes = await getChapterEntityAttributesByBookEntityId(bookEntity.id);

    if (attributes.length === 0) {
      ctx.log.info('No character attributes found for arc extraction');
      return Response.json({
        bookEntityId: bookEntity.id,
        arcsCreated: 0
      });
    }

    ctx.log.info(`Found ${attributes.length} character attributes to analyze`);

    // Fetch all relationships for the book
    const allRelationships = (
      await getChapterRelationshipsWithChapterAndEntitiesByBookId(book.id)
    ).sort((a, b) => a.chapter.idx - b.chapter.idx);

    ctx.log.info(`Found ${allRelationships.length} relationships to analyze`);

    // Filter relationships to only include those involving this character
    const relevantRelationships = allRelationships.filter(
      (rel) =>
        rel.sourceEntity.id === bookEntity.id || rel.targetEntity.id === bookEntity.id
    );

    ctx.log.info(
      `Found ${relevantRelationships.length} relationships involving ${bookEntity.name}`
    );

    const maxChapterIdx = await getMaxChapterIdxByBookId(book.id);

    // Determine minor until chapter index if applicable
    let minorUntilChapterIdx: number | undefined;
    if (bookEntity.minorUntilChapterId) {
      const minorUntilChapter = await getChapterById(bookEntity.minorUntilChapterId);
      if (minorUntilChapter) {
        minorUntilChapterIdx = minorUntilChapter.idx;
      }
    }

    const relationships = relevantRelationships.map(
      (rel) =>
        `(${rel.sourceEntity.friendlyId})-[:${rel.predicateType} {chapter: ${rel.chapter.idx}, description: "${rel.predicateDescription}"}]->(${rel.targetEntity.friendlyId})`
    );

    const attributesText = attributes
      .map((attr) => `${attr.name} ${attr.value} ${attr.evidence}`)
      .join(' ');
    const relationshipsText = relationships.join(' ');
    const combinedText = `${attributesText} ${relationshipsText}`;

    const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
      bookId: book.id,
      bookEntityIds: [bookEntity.id],
      searchTextForMentions: combinedText
    });

    ctx.log.info(
      `Found ${relatedEntitiesResult.entities.length} related entities for character arc extraction`
    );

    const snapshots = await extractCharacterArc(
      {
        book,
        bookEntity,
        attributes,
        relationships,
        relatedEntities:
          relatedEntitiesResult.entities.length > 0
            ? relatedEntitiesResult.entities
            : undefined,
        contextEntityIds: relatedEntitiesResult.contextEntityIds,
        maxChapterIdx,
        minorUntilChapterIdx
      },
      ctx
    );

    // Generate friendly ID prefix for these arcs
    const friendlyIdPrefix = await generateUniqueArcFriendlyPrefix({
      bookId: book.id,
      arcType: 'CHARACTER',
      entityIds: [bookEntity.id]
    });

    // Create book arcs and link to character entity
    const arcsToInsert = snapshots.map((snapshot) => ({
      id: uuidv7(),
      bookId: book.id,
      type: 'CHARACTER',
      startChapterId: snapshot.startChapterId,
      endChapterId: snapshot.endChapterId,
      title: snapshot.title,
      content: snapshot.content,
      bookEntityIds: [bookEntity.id]
    }));

    const createdArcs = await createBookArcs(arcsToInsert, friendlyIdPrefix);

    ctx.log.info(`Created ${createdArcs.length} character arc snapshots`);

    // Isolate arcs inline
    const isolatedArcs = await isolateArcs(
      {
        arcType: 'CHARACTER',
        arcs: createdArcs,
        bookId: book.id,
        bookTitle: book.title,
        entities: [{ name: bookEntity.name, type: bookEntity.type }]
      },
      ctx
    );

    return Response.json({
      bookEntityId: bookEntity.id,
      arcsCreated: createdArcs.length,
      arcsIsolated: isolatedArcs.length
    });
  }
);

const CharacterArcOutputSchema = v.object({
  snapshots: v.array(
    v.object({
      chapters: v.string(),
      detail: v.string(),
      title: v.string()
    })
  )
});

async function extractCharacterArc(
  {
    book,
    bookEntity,
    attributes,
    relationships,
    relatedEntities,
    contextEntityIds,
    maxChapterIdx,
    minorUntilChapterIdx
  }: {
    book: { id: string; title: string };
    bookEntity: { id: string; name: string; friendlyId: string };
    attributes: Array<{
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
    minorUntilChapterIdx?: number;
  },
  ctx: WorkflowContext
) {
  const userText = extractCharacterArcPrompt.render({
    character: {
      name: bookEntity.name,
      friendlyId: bookEntity.friendlyId
    },
    attributes,
    relationships,
    relatedEntities,
    minorUntilChapterIdx
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

  const watcher = watchAgent('extractCharacterArc', agent, ctx, 'snapshots');

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Extract character arc aborted');
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
      chapters: getText(querySelector(snapshot, 'chapters')).trim(),
      detail: getText(querySelector(snapshot, 'detail')).trim(),
      title: getText(querySelector(snapshot, 'phase')).trim()
    }))
  };

  const validatedData = v.safeParse(CharacterArcOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse character arc snapshots: ${v.summarize(validatedData.issues)}`
    );
  }

  if (validatedData.output.snapshots.length === 0) {
    throw new RecoverableError('No snapshots found in response');
  }

  const mappedData: {
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
      startChapterId: startChapter.id,
      endChapterId: endChapter.id,
      content: snapshot.detail,
      title: snapshot.title
    });
  }

  return mappedData;
}

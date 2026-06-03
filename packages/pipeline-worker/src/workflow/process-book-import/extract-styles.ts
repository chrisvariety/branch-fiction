import { v7 as uuidv7 } from 'uuid';

import { NewBookStyle } from '@/app/lib/db/types';
import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { createBookStyles } from '@/lib/db/models/book-style/create-book-style';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterScenesByBookId } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import { organizeParagraphsIntoScenes } from '@/lib/lit/organize-paragraphs-into-scenes';
import { getAssistantText } from '@/lib/llm/agent';
import {
  getAttribute,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@/lib/llm/xml';
import extractStylePrompt from '@/lib/prompts/import/extract-style';
import selectDistinctivePassagesPrompt from '@/lib/prompts/import/select-distinctive-passages';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

type ScenesWithParagraphs = ReturnType<
  typeof organizeParagraphsIntoScenes<
    Awaited<ReturnType<typeof getChapterScenesByBookId>>[number],
    Awaited<ReturnType<typeof getNonEmptyChapterParagraphsByBookId>>[number]
  >
>;

export const handler = createWorkflowFunction<
  {
    bookImportId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  },
  { bookId: string; povEntities: string[]; majorityPovEntity: string }
>(
  {
    name: ({ book }, retryCount) =>
      `Extract Styles ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookImportId }) => {
      const bookImport = await getBookImportById(bookImportId);
      if (!bookImport) throw new UnrecoverableError('Book Import not found');
      if (!bookImport.bookId) throw new UnrecoverableError('Book ID not found');
      const book = await getBookById(bookImport.bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      return { book, bookImport };
    },
    check: async (_payload, result) => ({
      passed: result.povEntities.length > 0,
      severity: 'WARN' as const,
      metadata: { povEntityCount: result.povEntities.length }
    }),
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
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting style extraction');

    await ctx.narrate("Extracting the 'essence' of each perspective.");

    const allScenes = await getChapterScenesByBookId(book.id);
    const paragraphs = await getNonEmptyChapterParagraphsByBookId(book.id);

    const scenesWithParagraphs = organizeParagraphsIntoScenes(allScenes, paragraphs);

    const scenesByPovEntity = scenesWithParagraphs.reduce<
      Record<string, typeof scenesWithParagraphs>
    >((acc, scene) => {
      const povEntity = scene.povEntity;
      if (!acc[povEntity]) {
        acc[povEntity] = [];
      }
      acc[povEntity].push(scene);
      return acc;
    }, {});

    const povEntities = Object.keys(scenesByPovEntity);

    if (povEntities.length === 0) {
      throw new Error('No POV entities found??');
    }

    const majorityPovEntity = determineMajorityPovEntity(scenesByPovEntity);

    const bookStyles: NewBookStyle[] = [];

    for (const povEntity of povEntities) {
      ctx.log.info(`\nProcessing POV Entity: ${povEntity}`);
      if (povEntities.length > 1) {
        await ctx.narrate(`Now ${povEntity}.`);
      }
      const scenes = scenesByPovEntity[povEntity];

      const allText = scenes.flatMap((s) => s.paragraphs.map((p) => p.content));
      const selectedContents = await selectDistinctivePassages(ctx, povEntity, allText);
      ctx.log.info(
        `Selected ${selectedContents.length} passages via LLM distinctiveness ranking`
      );

      const { styleAnalysis } = await extractStyle(ctx, povEntity, selectedContents);

      bookStyles.push({
        id: uuidv7(),
        bookId: book.id,
        pov: scenes[0].pov,
        povEntity,
        povBookEntityId: scenes[0].povBookEntityId,
        styleAnalysis,
        isMajority: majorityPovEntity === povEntity
      });
    }

    await createBookStyles(bookStyles);

    const majorityStyle = bookStyles.find((s) => s.isMajority);
    if (majorityStyle && bookStyles.length > 1) {
      await ctx.narrate(
        `Mostly ${majorityStyle.pov}, from the point of view of ${majorityPovEntity}.`
      );
    } else if (majorityStyle) {
      await ctx.narrate(
        `Looks like ${majorityStyle.pov}, from the point of view of ${majorityPovEntity}.`
      );
    }

    return {
      bookId: book.id,
      povEntities,
      majorityPovEntity
    };
  }
);

function determineMajorityPovEntity(
  scenesByPovEntity: Record<string, ScenesWithParagraphs>
) {
  const povEntityStats = Object.keys(scenesByPovEntity).map((povEntity) => {
    const scenes = scenesByPovEntity[povEntity];
    const totalParagraphs = scenes.reduce(
      (sum, scene) => sum + scene.paragraphs.length,
      0
    );
    const totalTokens = scenes.reduce(
      (sum, scene) =>
        sum + scene.paragraphs.reduce((pSum, p) => pSum + estimateTokens(p.content), 0),
      0
    );

    return {
      povEntity,
      sceneCount: scenes.length,
      paragraphCount: totalParagraphs,
      tokenCount: totalTokens
    };
  });

  povEntityStats.sort((a, b) => b.paragraphCount - a.paragraphCount);

  return povEntityStats[0].povEntity;
}

async function extractStyle(ctx: WorkflowContext, povEntity: string, contents: string[]) {
  const userText = extractStylePrompt.render({
    povEntity,
    contents
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'extractStyle',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const styleAnalysis = getAssistantText(message);

  const ast = parse(styleAnalysis);
  const analysis = getText(querySelector(ast, 'style_analysis')).trim() || styleAnalysis;
  if (!analysis) {
    throw new RecoverableError(
      `Style extraction returned empty result for POV entity ${povEntity}`
    );
  }

  return { styleAnalysis: analysis };
}

async function selectDistinctivePassages(
  ctx: WorkflowContext,
  povEntity: string,
  paragraphs: string[]
): Promise<string[]> {
  if (paragraphs.length === 0) return [];

  const totalTokens = paragraphs.reduce((sum, p) => sum + estimateTokens(p), 0);
  if (totalTokens <= TOKEN_COUNT_MAX) return paragraphs;

  const passages: { n: number; content: string }[] = [];
  let currentParts: string[] = [];
  let currentTokens = 0;
  let nextN = 1;
  for (const p of paragraphs) {
    const tokens = estimateTokens(p);
    if (currentTokens + tokens > PASSAGE_TARGET_TOKENS && currentParts.length > 0) {
      passages.push({ n: nextN++, content: currentParts.join('\n\n') });
      currentParts = [];
      currentTokens = 0;
    }
    currentParts.push(p);
    currentTokens += tokens;
  }
  if (currentParts.length > 0) {
    passages.push({ n: nextN++, content: currentParts.join('\n\n') });
  }

  // Split passages into batches that comfortably fit in a single LLM call.
  const BATCH_TOKEN_LIMIT = 30_000;
  const batches: (typeof passages)[] = [];
  let batch: typeof passages = [];
  let batchTokens = 0;
  for (const passage of passages) {
    const tokens = estimateTokens(passage.content);
    if (batchTokens + tokens > BATCH_TOKEN_LIMIT && batch.length > 0) {
      batches.push(batch);
      batch = [];
      batchTokens = 0;
    }
    batch.push(passage);
    batchTokens += tokens;
  }
  if (batch.length > 0) batches.push(batch);

  const TARGET_TOTAL_PASSAGES = 30;
  const selectCount = Math.max(2, Math.ceil(TARGET_TOTAL_PASSAGES / batches.length));

  const selectedNs = new Set<number>();

  for (let i = 0; i < batches.length; i++) {
    const batchPassages = batches[i];
    const validNs = new Set(batchPassages.map((p) => p.n));

    const userText = selectDistinctivePassagesPrompt.render({
      povEntity,
      passages: batchPassages,
      selectCount
    });

    const { model, apiKey, reasoning } = ctx.getPiModel('piTextLight');
    const message = await ctx.traceComplete(
      'selectDistinctivePassages',
      model,
      { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);
    const text = getAssistantText(message);
    const ast = parse(text);
    const container = querySelector(ast, 'distinct_passages');
    const nodes = container ? querySelectorAll(container, 'passage') : [];

    let batchSelectedCount = 0;
    for (const node of nodes) {
      const raw = getAttribute(node, 'n');
      if (!raw) continue;
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n) || !validNs.has(n)) continue;
      if (selectedNs.has(n)) continue;
      selectedNs.add(n);
      batchSelectedCount++;
    }

    ctx.log.info(
      `Distinctive passage selection batch ${i + 1}/${batches.length}: ${batchSelectedCount} passages`
    );
  }

  if (selectedNs.size === 0) {
    throw new RecoverableError(
      `Distinctive passage selection returned no valid selections for POV entity ${povEntity}`
    );
  }

  // Emit selections in original order, capped at the token budget.
  const result: string[] = [];
  let usedTokens = 0;
  for (const passage of passages) {
    if (!selectedNs.has(passage.n)) continue;
    const tokens = estimateTokens(passage.content);
    if (usedTokens + tokens > TOKEN_COUNT_MAX) break;
    result.push(passage.content);
    usedTokens += tokens;
  }

  return result;
}

const TOKEN_COUNT_MAX = 100_000;

// Target size for one selectable passage: large enough to display meaningful
// style (sentence rhythm, paragraph structure, dialogue framing) but small
// enough that ~14 fit in a single selector batch.
const PASSAGE_TARGET_TOKENS = 2048;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

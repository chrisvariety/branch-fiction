import { readFile } from 'node:fs/promises';

import type { Image, Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import slug from 'slug';
import { visit } from 'unist-util-visit';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { BookEntity, NewChapterParagraph } from '@/app/lib/db/types';
import { parseBook, Toc } from '@/app/lib/lit';
import { applyImageDinkus } from '@/app/lib/lit/chapter-to-markdown';
import { bridgeUpdateBookImport } from '@/lib/bridge';
import { createBookCategories } from '@/lib/db/models/book-category/create-book-category';
import { getBookCategoriesByBookId } from '@/lib/db/models/book-category/get-book-category';
import { createBookEntities } from '@/lib/db/models/book-entity/create-book-entity';
import {
  getBookEntitiesByBookId,
  getBookEntitiesByBookIdAndTypes
} from '@/lib/db/models/book-entity/get-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { createBook } from '@/lib/db/models/book/create-book';
import { createChapterEntityAttributes } from '@/lib/db/models/chapter-entity-attribute/create-chapter-entity-attribute';
import {
  getChapterEntityAttributesByBookEntityIds,
  getChapterEntityAttributesByBookEntityIdsAndCategories
} from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import { createChapterParagraphs } from '@/lib/db/models/chapter-paragraph/create-chapter-paragraph';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterScenesByBookId } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { createChapters } from '@/lib/db/models/chapter/create-chapter';
import { getChaptersByBookId } from '@/lib/db/models/chapter/get-chapter';
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import { parseChapterRange } from '@/lib/lit/chapter-range';
import { entityThresholds } from '@/lib/lit/entity-significance-estimate';
import { gatherMentions } from '@/lib/lit/gather-mentions';
import { entityNamesFormatted } from '@/lib/lit/names';
import { splitParagraphsPreservingBlanks } from '@/lib/lit/split-paragraphs';
import { getAssistantText } from '@/lib/llm/agent';
import {
  getAttribute,
  extractWrappedXml,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@/lib/llm/xml';
import continueCharacterAppearance from '@/lib/prompts/import/continue-character-appearance';
import continueEntityAppearance from '@/lib/prompts/import/continue-entity-appearance';
import determineDinkusPrompt from '@/lib/prompts/import/determine-dinkus';
import extractChaptersFromToc from '@/lib/prompts/import/extract-chapters-from-toc';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type Logger,
  type WorkflowContext
} from '@/workflow/handler';

export const handler = createWorkflowFunction<
  {
    bookImportId: string;
  },
  {
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  },
  { bookId: string }
>(
  {
    name: (_, retryCount) => `import-book (${addOrdinalSuffix(retryCount + 1)} attempt)`,
    payload: async ({ bookImportId }) => {
      const bookImport = await getBookImportById(bookImportId);
      if (!bookImport) throw new UnrecoverableError('Book import not found');
      return { bookImport };
    },
    check: async (_payload, result) => {
      const chapters = await getChaptersByBookId(result.bookId);
      const paragraphs = await getNonEmptyChapterParagraphsByBookId(result.bookId);
      return {
        passed: chapters.length > 0 && paragraphs.length > 0,
        metadata: {
          chapterCount: chapters.length,
          paragraphCount: paragraphs.length
        }
      };
    },
    onFailure: async (_, error) => {
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ bookImport }, ctx) => {
    const previousInSeriesBookId = bookImport.previousInSeriesBookId;
    ctx.log
      .withMetadata({ bookImportId: bookImport.id })
      .info('Starting book import workflow');

    await bridgeUpdateBookImport({ lastError: null });

    await ctx.narrate(
      `Let's get started, cracking into "${bookImport.title}" now. Feel free to walk away and check back later, this will take a while.`
    );

    const filePath = bookImport.fileUrl;

    let parsedJson;
    try {
      const raw = await readFile(filePath, 'utf-8');
      parsedJson = JSON.parse(raw);
    } catch (e) {
      ctx.log.error(
        `Failed to read parsed book JSON: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
      throw new Error(
        `Failed to read parsed book JSON: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
    }

    let parsedBook;
    try {
      parsedBook = await parseBook(parsedJson);
    } catch (e) {
      throw new Error(
        `Failed to parse book: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
    }

    const meta = parsedBook.getMetadata();
    const bookTitle = bookImport.title;
    const toc = parsedBook.getToc();
    if (!toc.length) {
      throw new Error('No table of contents found');
    }
    ctx.log
      .withMetadata({ toc, meta })
      .info('Parsed book metadata and table of contents');

    const allChapters = await extractChapters(toc, ctx);

    ctx.log
      .withMetadata({
        chapterCount: allChapters.length,
        chapters: allChapters.map((c) => c.title)
      })
      .info('Extracted chapters from table of contents');

    if (!allChapters.length) {
      throw new Error('No chapters found');
    }

    if (allChapters.length === 1) {
      throw new UnrecoverableError(
        'Book has only one chapter — single-chapter books are not currently supported'
      );
    }

    const firstChapterTitle = allChapters[0].title;
    const lastChapterTitle = allChapters[allChapters.length - 1].title;
    const formulaicTitles =
      isFormulaicChapterTitle(firstChapterTitle, 1) &&
      isFormulaicChapterTitle(lastChapterTitle, allChapters.length);
    await ctx.narrate(
      `${allChapters.length} chapters, "${firstChapterTitle}" through "${lastChapterTitle}".${formulaicTitles ? ' Really creative.' : ''}`
    );

    // Find non-chapter TOC items (before first chapter and after last chapter)
    const firstChapterHref = allChapters[0].href;
    const lastChapterHref = allChapters[allChapters.length - 1].href;
    const tocItemsRemoved: Toc[] = [];
    let foundFirstChapter = false;
    let foundLastChapter = false;

    for (const item of toc) {
      if (item.href === firstChapterHref) {
        foundFirstChapter = true;
      } else if (item.href === lastChapterHref) {
        foundLastChapter = true;
      } else if (!foundFirstChapter || foundLastChapter) {
        tocItemsRemoved.push(item);
      }
    }

    ctx.log.withMetadata({ title: bookTitle }).info('Creating new book record');

    const book = await createBook({
      id: uuidv7(),
      userId: bookImport.userId,
      shareCode: crypto.randomUUID(),
      baseSlug: slug(bookTitle),
      title: bookTitle,
      isbn: null,
      language: meta.language ?? null,
      publisher: meta.publisher ?? null,
      imageUrl: bookImport.imageUrl
    });

    const bookId = book.id;

    ctx.log
      .withMetadata({
        chapterCount: allChapters.length,
        chapters: allChapters.map((c, idx) => ({
          idx: idx + 1,
          title: c.title,
          href: c.href
        }))
      })
      .info('Creating chapter records');

    const chapters = await createChapters(
      allChapters.map((chapter, idx) => ({
        id: uuidv7(),
        idx: idx + 1,
        href: chapter.href,
        title: chapter.title,
        bookId
      }))
    );

    if (!chapters) {
      throw new Error('No chapters created?');
    }

    const dinkusCandidates = await findRepeatedImagesWithContext(chapters, parsedBook);

    const dinkusImageSrcs: string[] = [];
    const candidateCount = Object.keys(dinkusCandidates).length;
    if (candidateCount > 0) {
      await ctx.narrate(`Diving in a bit to see how this book is put together.`);
      for (const [imgSrc, contexts] of Object.entries(dinkusCandidates)) {
        const isDinkus = await determineDinkus(
          imgSrc,
          contexts.map((c) => c.context),
          ctx
        );
        if (isDinkus) {
          dinkusImageSrcs.push(imgSrc);
        }
      }
    }

    // ctx.log.withMetadata({ dinkusImageSrcs }).info('Dinkus image sources');

    const chapterIdToContent: Record<string, string> = {};
    for (const chapter of chapters) {
      chapterIdToContent[chapter.id] = applyImageDinkus(
        parsedBook.getChapterMarkdown(chapter.href),
        dinkusImageSrcs
      );
    }
    const sortedChapters = chapters.sort((a, b) => a.idx - b.idx);

    let bookChapterIdx = 1;
    for (const chapter of sortedChapters) {
      const chapterParagraphs: NewChapterParagraph[] = [];

      const paragraphs = splitParagraphsPreservingBlanks(chapterIdToContent[chapter.id]);
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];

        chapterParagraphs.push({
          id: uuidv7(),
          bookId: chapter.bookId,
          chapterId: chapter.id,
          chapterIdx: chapter.idx,
          paragraphIdx: i + 1,
          bookParagraphIdx: bookChapterIdx + i,
          content: paragraph
        });
      }
      // doing this in the loop to avoid Error: MAX_PARAMETERS_EXCEEDED: Max number of parameters (65534) exceeded
      await createChapterParagraphs(chapterParagraphs);

      bookChapterIdx += paragraphs.length;
    }

    if (previousInSeriesBookId) {
      const previousBookId = previousInSeriesBookId;
      const { skippedEntityIds } = await copyPreviousBookData(
        previousBookId,
        {
          id: book.id,
          title: book.title
        },
        ctx.log
      );

      // Copy and consolidate physical attributes from the previous book
      const firstChapter = sortedChapters[0];
      await Promise.all([
        copyPhysicalAttributes(
          previousBookId,
          { id: book.id, title: book.title },
          firstChapter.id,
          'CHARACTER',
          skippedEntityIds,
          ctx
        ),
        copyPhysicalAttributes(
          previousBookId,
          { id: book.id, title: book.title },
          firstChapter.id,
          'PLACE',
          skippedEntityIds,
          ctx
        )
      ]);
    }

    await bridgeUpdateBookImport({
      bookId
    });

    return { bookId };
  }
);

async function extractChapters(toc: Toc[], ctx: WorkflowContext): Promise<Toc[]> {
  // Add numeric prefixes to handle duplicate titles (e.g., multiple chapters with the same Character Name as the Chapter Name)
  const numberedTitles = toc.map((chapter, idx) => `${idx + 1}. ${chapter.title}`);

  const userText = extractChaptersFromToc.render({
    titles: numberedTitles
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piTextLight');
  const message = await ctx.traceComplete(
    'extractChapters',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);

  const xml = extractWrappedXml(text, 'chapters');
  if (!xml) {
    ctx.log
      .withMetadata({ text })
      .warn('No <chapters> found in extract-chapters response');
    return [];
  }

  const ast = parse(xml);
  const chapterNodes = querySelectorAll(ast, 'chapter');

  return chapterNodes.flatMap((node) => {
    const raw = getText(node).trim();
    if (!raw) return [];
    let range;
    try {
      range = parseChapterRange(raw, toc.length);
    } catch (e) {
      ctx.log
        .withMetadata({
          returnedRange: raw,
          tocLength: toc.length,
          error: e instanceof Error ? e.message : String(e)
        })
        .warn('Failed to parse chapter range');
      return [];
    }
    const expanded: Toc[] = [];
    for (let i = range.startChapterIdx; i <= range.endChapterIdx; i++) {
      const idx = i - 1;
      if (idx >= 0 && idx < toc.length) {
        expanded.push(toc[idx]);
      } else {
        ctx.log
          .withMetadata({ returnedRange: raw, index: i, tocLength: toc.length })
          .warn('Chapter index out of range');
      }
    }
    return expanded;
  });
}

async function determineDinkus(
  _imgSrc: string,
  excerpts: string[],
  ctx: WorkflowContext
) {
  const userText = determineDinkusPrompt.render({
    excerpts
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piTextLight');
  const message = await ctx.traceComplete(
    'determineDinkus',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);

  return text.includes('<decision>dinkus</decision>');
}

const DINKUS_IMAGE_THRESHOLD = 5;
const CONTEXT_LINES = 4;

async function findRepeatedImagesWithContext(
  chapters: Array<{ id: string; href: string; idx: number; bookId: string }>,
  parsedBook: Awaited<ReturnType<typeof parseBook>>
): Promise<
  Record<
    string,
    Array<{
      chapterId: string;
      context: string;
    }>
  >
> {
  // First pass: count all image occurrences and track unique chapters per image
  const imageCounts: Map<string, number> = new Map();
  const imageChapterMap: Map<
    string,
    Array<{ chapterId: string; markdownTree: Root }>
  > = new Map();

  for (const chapter of chapters) {
    const markdown = parsedBook.getChapterMarkdown(chapter.href);
    const tree = fromMarkdown(markdown);

    // Track which images we've seen in this chapter to avoid duplicates
    const imagesInThisChapter = new Set<string>();

    visit(tree, 'image', (node: Image) => {
      const src = node.url;
      if (src) {
        imageCounts.set(src, (imageCounts.get(src) || 0) + 1);

        // Only add each chapter once per image, even if image appears multiple times
        if (!imagesInThisChapter.has(src)) {
          imagesInThisChapter.add(src);

          if (!imageChapterMap.has(src)) {
            imageChapterMap.set(src, []);
          }

          imageChapterMap.get(src)!.push({
            chapterId: chapter.id,
            markdownTree: tree
          });
        }
      }
    });
  }

  // Find images that appear more than the threshold, sorted by count (descending)
  const repeatedImages = Array.from(imageCounts.entries())
    .filter(([_, count]) => count > DINKUS_IMAGE_THRESHOLD)
    .sort(([, countA], [, countB]) => countB - countA)
    .map(([src]) => src);

  // For each repeated image, collect 5 random samples with surrounding context
  const dinkusCandidates: Record<
    string,
    Array<{
      chapterId: string;
      context: string;
    }>
  > = {};

  for (const imageSrc of repeatedImages) {
    const occurrences = imageChapterMap.get(imageSrc) || [];

    // Randomly sample up to 5 occurrences
    const sampledOccurrences = occurrences
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(5, occurrences.length));

    dinkusCandidates[imageSrc] = [];

    for (const { chapterId, markdownTree } of sampledOccurrences) {
      const rootChildren = markdownTree.children;

      // Find the first image node at any level
      let imageIndex = -1;
      for (let i = 0; i < rootChildren.length; i++) {
        const child = rootChildren[i];
        let foundImage = false;

        // Check if this is an image at root level
        if (child.type === 'image' && child.url === imageSrc) {
          foundImage = true;
        } else {
          // Check if this node contains the image
          visit(child, 'image', (node: Image) => {
            if (node.url === imageSrc) {
              foundImage = true;
              return 'skip';
            }
          });
        }

        if (foundImage) {
          imageIndex = i;
          break;
        }
      }

      if (imageIndex >= 0) {
        // Skip images at the start (imageIndex === 0) since dinkus must be between paragraphs
        if (imageIndex === 0) {
          continue;
        }

        // Get surrounding nodes (including the one with the image)
        const contextStart = Math.max(0, imageIndex - CONTEXT_LINES);
        const contextEnd = Math.min(rootChildren.length, imageIndex + CONTEXT_LINES + 1);

        const contextNodes = rootChildren.slice(contextStart, contextEnd);
        const context = contextNodes
          .map((node) => toMarkdown(node).trim())
          .filter((text) => text.length > 0)
          .join('\n\n');

        dinkusCandidates[imageSrc].push({
          chapterId,
          context
        });
      }
    }
  }

  // Filter out images with no valid contexts (e.g., all occurrences were at imageIndex === 0)
  return Object.fromEntries(
    Object.entries(dinkusCandidates).filter(([_, contexts]) => contexts.length > 0)
  );
}

const NUMBER_WORDS_UNDER_20 = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen'
];
const TENS_WORDS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety'
];

const ROMAN_NUMERALS: Array<[number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i']
];

function numberToRoman(n: number): string | null {
  if (n <= 0 || n >= 4000) return null;
  let result = '';
  for (const [value, symbol] of ROMAN_NUMERALS) {
    while (n >= value) {
      result += symbol;
      n -= value;
    }
  }
  return result;
}

function numberToWords(n: number): string | null {
  if (n < 0 || n >= 100) return null;
  if (n < 20) return NUMBER_WORDS_UNDER_20[n];
  const tens = TENS_WORDS[Math.floor(n / 10)];
  const ones = n % 10;
  return ones === 0 ? tens : `${tens}-${NUMBER_WORDS_UNDER_20[ones]}`;
}

function normalizeChapterTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFormulaicChapterTitle(title: string, idx: number): boolean {
  const normalized = normalizeChapterTitle(title);
  const word = numberToWords(idx);
  if (word && normalized === normalizeChapterTitle(`chapter ${word}`)) return true;
  const roman = numberToRoman(idx);
  if (roman && (normalized === roman || normalized === `chapter ${roman}`)) return true;
  return false;
}

const excludeKeys = <T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: readonly K[]
): Omit<T, K> => {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
};

const EXCLUDED_ENTITY_ATTRIBUTES = [
  'id',
  'createdAt',
  'updatedAt',
  'significanceTier',
  'significanceRank',
  'description'
] as const satisfies readonly (keyof BookEntity)[];

async function copyPreviousBookData(
  previousBookId: string,
  book: { id: string; title: string },
  log: Logger
): Promise<{ skippedEntityIds: Set<string> }> {
  // copy previous categories
  const previousBookCategories = await getBookCategoriesByBookId(previousBookId);

  if (previousBookCategories.length) {
    log
      .withMetadata({ bookId: book.id, bookTitle: book.title })
      .info(`Copying categories from previous book (${previousBookId})`);

    await createBookCategories(
      previousBookCategories.map((c) => ({
        id: uuidv7(),
        bookId: book.id,
        name: c.name,
        description: c.description,
        type: c.type,
        exclusion: c.exclusion,
        examples: c.examples
      }))
    );
  }

  // copy previous entities
  const previousEntities = await getBookEntitiesByBookId(previousBookId);

  // Calculate significance tiers for previous book entities using z-score estimates
  const previousParagraphs = await getNonEmptyChapterParagraphsByBookId(previousBookId);
  const previousScenes = await getChapterScenesByBookId(previousBookId);
  const previousContent = previousParagraphs.map((p) => p.content).join('\n');

  const previousPovEntityIds = Array.from(
    new Set(previousScenes.flatMap((scene) => scene.povBookEntityId || []))
  );

  const previousMentions = gatherMentions(
    previousContent,
    previousEntities,
    previousPovEntityIds
  );

  // Count scene appearances for location/setting entities
  const sceneAppearances = new Map<string, number>();
  for (const scene of previousScenes) {
    if (scene.locationBookEntityId) {
      sceneAppearances.set(
        scene.locationBookEntityId,
        (sceneAppearances.get(scene.locationBookEntityId) || 0) + 1
      );
    }
    if (scene.settingBookEntityId) {
      sceneAppearances.set(
        scene.settingBookEntityId,
        (sceneAppearances.get(scene.settingBookEntityId) || 0) + 1
      );
    }
  }

  const sceneWeight =
    previousScenes.length > 0
      ? Math.max(1, Math.floor(previousParagraphs.length / previousScenes.length))
      : 1;

  const augmentedMentions = Array.from(previousMentions).map((m) => ({
    ...m,
    mentionCount: m.mentionCount + (sceneAppearances.get(m.id) || 0) * sceneWeight
  }));

  const mentionCounts = augmentedMentions.map((m) => m.mentionCount);
  const { primaryThreshold, secondaryThreshold } = entityThresholds(mentionCounts);

  // Determine tiers for previous book entities
  const entityTiers = new Map<string, 'PRIMARY' | 'SECONDARY' | null>();
  for (const mention of augmentedMentions) {
    let tier: 'PRIMARY' | 'SECONDARY' | null;
    if (previousPovEntityIds.includes(mention.id)) {
      tier = 'PRIMARY';
    } else if (mention.mentionCount >= primaryThreshold) {
      tier = 'PRIMARY';
    } else if (mention.mentionCount >= secondaryThreshold) {
      tier = 'SECONDARY';
    } else {
      tier = null;
    }
    entityTiers.set(mention.id, tier);
  }

  // Get new book paragraphs and check for mentions
  const newBookParagraphs = await getNonEmptyChapterParagraphsByBookId(book.id);
  const newBookContent = newBookParagraphs.map((p) => p.content).join('\n');

  // We don't have POV entities for the new book yet, so pass empty array
  const newBookMentions = gatherMentions(newBookContent, previousEntities, []);
  const mentionedEntityIds = new Set(Array.from(newBookMentions).map((m) => m.id));

  // Filter entities based on significance tier and new book mentions
  const entitiesToCopy = previousEntities.filter((entity) => {
    const tier = entityTiers.get(entity.id);

    // Copy all PRIMARY entities
    if (tier === 'PRIMARY') {
      return true;
    }

    // Copy OBJECT or MAGIC_SYSTEM entities with PRIMARY significanceTier regardless of z-score tier
    if (
      (entity.type === 'OBJECT' || entity.type === 'MAGIC_SYSTEM') &&
      entity.significanceTier === 'PRIMARY'
    ) {
      return true;
    }

    // Copy MENTIONED_INDIVIDUAL entities with PRIMARY significanceTier only if mentioned in new book
    if (
      entity.type === 'MENTIONED_INDIVIDUAL' &&
      entity.significanceTier === 'PRIMARY' &&
      mentionedEntityIds.has(entity.id)
    ) {
      return true;
    }

    // Copy SECONDARY entities only if mentioned in new book
    if (tier === 'SECONDARY') {
      if (mentionedEntityIds.has(entity.id)) {
        return true;
      } else {
        log.info(
          `Skipping secondary entity ${entity.name} because it was not mentioned in the new book. (typically dead characters)`
        );
        return false;
      }
    }

    // Skip all other entities
    return false;
  });

  // Determine which entities were skipped by comparing to original list
  const entitiesToCopyIds = new Set(entitiesToCopy.map((e) => e.id));
  const skippedEntityIds = new Set(
    previousEntities.filter((e) => !entitiesToCopyIds.has(e.id)).map((e) => e.id)
  );

  log
    .withMetadata({
      bookId: book.id,
      bookTitle: book.title,
      totalPreviousEntities: previousEntities.length,
      primaryCount: Array.from(entityTiers.values()).filter((t) => t === 'PRIMARY')
        .length,
      secondaryCount: Array.from(entityTiers.values()).filter((t) => t === 'SECONDARY')
        .length,
      entitiesToCopyCount: entitiesToCopy.length,
      skippedEntityIds: Array.from(skippedEntityIds).map((id) => {
        const entity = previousEntities.find((e) => e.id === id);
        return entity?.name || id;
      })
    })
    .info('Copying entities from previous book based on significance tiers');

  if (entitiesToCopy.length) {
    const batchSize = 500;
    for (let i = 0; i < entitiesToCopy.length; i += batchSize) {
      const batch = entitiesToCopy.slice(i, i + batchSize);
      await createBookEntities(
        batch.map((entity) => ({
          id: uuidv7(),
          ...excludeKeys(entity, EXCLUDED_ENTITY_ATTRIBUTES),
          bookId: book.id,
          continuedFromBookEntityId: entity.id
        }))
      );
    }
  }

  return { skippedEntityIds };
}

const ContinueAppearanceSchema = v.object({
  characters: v.array(
    v.object({
      id: v.string(),
      attributes: v.array(
        v.object({
          category: v.string(),
          name: v.string(),
          value: v.string(),
          evidence: v.string()
        })
      )
    })
  )
});

const ContinueEntityAppearanceSchema = v.object({
  entities: v.array(
    v.object({
      id: v.string(),
      attributes: v.array(
        v.object({
          category: v.string(),
          name: v.string(),
          value: v.string(),
          evidence: v.string()
        })
      )
    })
  )
});

async function copyPhysicalAttributes(
  previousBookId: string,
  newBook: { id: string; title: string },
  firstChapterId: string,
  type: 'CHARACTER' | 'PLACE',
  excludedPreviousEntityIds: Set<string> | undefined,
  ctx: WorkflowContext
) {
  const previousEntities = (
    await getBookEntitiesByBookIdAndTypes(previousBookId, [type])
  ).filter(
    (entity) =>
      /* only includes PRIMARY + SECONDARY entities, the rest are in this excluded Set */
      !excludedPreviousEntityIds?.has(entity.id)
  );

  // Get physical attributes for those entities
  const previousAttributes = previousEntities.length
    ? type === 'PLACE'
      ? /* try all attributes for PLACEs - key information can be across a variety of categories */
        await getChapterEntityAttributesByBookEntityIds(
          previousEntities.map((entity) => entity.id)
        )
      : await getChapterEntityAttributesByBookEntityIdsAndCategories(
          previousEntities.map((entity) => entity.id),
          ['PHYSICAL', 'MAGICAL']
        )
    : [];

  const entityData = previousEntities
    .map((entity) => ({
      friendlyId: entity.friendlyId,
      name: entityNamesFormatted(entity),
      type: entity.type,
      attributes: previousAttributes.filter(
        (attribute) => attribute.bookEntityId === entity.id
      )
    }))
    .filter((entity) => entity.attributes.length > 0);

  if (!entityData.length) {
    ctx.log
      .withMetadata({ previousBookId, newBookId: newBook.id })
      .info(
        `No ${type.toLowerCase()}s with physical attributes - skipping physical attribute copy`
      );
    return;
  }

  ctx.log
    .withMetadata({
      previousBookId,
      newBookId: newBook.id,
      entityCount: entityData.length,
      entities: entityData.map((e) => e.name)
    })
    .info(`Processing ${type.toLowerCase()} physical attributes from previous book`);

  const schema =
    type === 'CHARACTER' ? ContinueAppearanceSchema : ContinueEntityAppearanceSchema;

  const userText =
    type === 'CHARACTER'
      ? continueCharacterAppearance.render({ characters: entityData })
      : continueEntityAppearance.render({ entities: entityData });

  const wrapperTag = type === 'CHARACTER' ? '<characters>' : '<entities>';
  const itemTag = type === 'CHARACTER' ? 'character' : 'entity';

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'copyPhysicalAttributes',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, type === 'CHARACTER' ? 'characters' : 'entities');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new RecoverableError(`No ${wrapperTag} found in response`);
  }
  ctx.log.info(`Agent: captured ${wrapperTag} (length: ${xml.length})`);

  const ast = parse(xml);
  const itemNodes = querySelectorAll(ast, itemTag);

  const items = itemNodes.map((node) => ({
    id: getAttribute(node, 'id') || '',
    attributes: querySelectorAll(node, 'attribute').map((attrNode) => ({
      category: getAttribute(attrNode, 'category') || '',
      name: getAttribute(attrNode, 'name') || '',
      value: getText(querySelector(attrNode, 'value')).trim(),
      evidence: getText(querySelector(attrNode, 'evidence')).trim()
    }))
  }));

  const data = type === 'CHARACTER' ? { characters: items } : { entities: items };

  const parsedResult = v.parse(schema, data);

  const resultEntities =
    'characters' in parsedResult ? parsedResult.characters : parsedResult.entities;

  const newBookEntities = await getBookEntitiesByBookIdAndTypes(newBook.id, [type]);

  const attributesToCreate = [];
  for (const entity of resultEntities) {
    const newEntity = newBookEntities.find((e) => e.friendlyId === entity.id);
    if (!newEntity) {
      ctx.log
        .withMetadata({ entityId: entity.id, newBookId: newBook.id })
        .warn(`${type} from previous book not found in new book - skipping attributes`);
      continue;
    }

    for (const attribute of entity.attributes) {
      attributesToCreate.push({
        id: uuidv7(),
        bookId: newBook.id,
        bookEntityId: newEntity.id,
        chapterId: firstChapterId,
        category: 'PHYSICAL', // intentionally discarding `attribute.category`, which is something like "Base Physiology", etc.
        name: attribute.name,
        value: attribute.value,
        evidence: `[ESTABLISHED_LORE] ${attribute.evidence}`
      });
    }
  }

  if (attributesToCreate.length) {
    await createChapterEntityAttributes(attributesToCreate);
    ctx.log
      .withMetadata({
        newBookId: newBook.id,
        attributeCount: attributesToCreate.length
      })
      .info(
        `Successfully copied ${type.toLowerCase()} physical attributes to first chapter of new book`
      );
  }
}

import dedent from 'dedent';
import pluralize from 'pluralize-esm';
import { v7 as uuidv7 } from 'uuid';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getDb } from '@/lib/db';
import {
  getBookEntitiesByBookId,
  getBookEntityByBookIdAndFriendlyId
} from '@/lib/db/models/book-entity/get-book-entity';
import { updateBookEntityById } from '@/lib/db/models/book-entity/update-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterScenesByBookId } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { UnrecoverableError } from '@/lib/error-types';
import { organizeParagraphsIntoScenes } from '@/lib/lit/organize-paragraphs-into-scenes';
import { getAssistantText } from '@/lib/llm/agent';
import { extractWrappedXml, getAttribute, parse, querySelectorAll } from '@/lib/llm/xml';
import determineOvermatchingEntityNamesPrompt from '@/lib/prompts/import/determine-overmatching-entity-names';
import { addOrdinalSuffix, createWorkflowFunction } from '@/workflow/handler';

const SAMPLE_PASSAGES = 5;
const CONTEXT_CHARS = 200;
const MIN_REVIEW_COUNT = 50;
const OUTLIER_LOG_Z = 2;

type ParagraphPov = { pov: string; povEntity: string };

type SearchIndex = {
  fullText: string;
  paragraphOffsets: { startOffset: number; bookParagraphIdx: number }[];
  povByParagraphIdx: Map<number, ParagraphPov>;
};

function buildSearchIndex(
  paragraphs: { content: string; bookParagraphIdx: number }[],
  scenesWithParagraphs: {
    pov: string;
    povEntity: string;
    paragraphs: { bookParagraphIdx: number }[];
  }[]
): SearchIndex {
  const paragraphOffsets: { startOffset: number; bookParagraphIdx: number }[] = [];
  let offset = 0;
  const SEPARATOR = '\n\n';
  for (let i = 0; i < paragraphs.length; i++) {
    paragraphOffsets.push({
      startOffset: offset,
      bookParagraphIdx: paragraphs[i].bookParagraphIdx
    });
    offset += paragraphs[i].content.length;
    if (i < paragraphs.length - 1) offset += SEPARATOR.length;
  }
  const fullText = paragraphs.map((p) => p.content).join(SEPARATOR);

  const povByParagraphIdx = new Map<number, ParagraphPov>();
  for (const scene of scenesWithParagraphs) {
    for (const p of scene.paragraphs) {
      povByParagraphIdx.set(p.bookParagraphIdx, {
        pov: scene.pov,
        povEntity: scene.povEntity
      });
    }
  }

  return { fullText, paragraphOffsets, povByParagraphIdx };
}

function paragraphIdxAtOffset(index: SearchIndex, offset: number): number | null {
  const offsets = index.paragraphOffsets;
  if (offsets.length === 0) return null;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid].startOffset <= offset) lo = mid;
    else hi = mid - 1;
  }
  return offsets[lo].bookParagraphIdx;
}

function formatPovTag(pov: ParagraphPov | undefined): string {
  if (!pov) return '';
  return ` (POV: ${pov.povEntity}, ${pov.pov})`;
}

function nameRegex(name: string): RegExp {
  return new RegExp(`\\b${RegExp.escape(name)}\\b`, 'gim');
}

function normalizeForLabelMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, '')
    .split(/\s+/)
    .map((w) => pluralize.singular(w))
    .join(' ');
}

// True when the candidate name is already present (as a whole word) inside the
// entity's label after light normalization — e.g. "Jack" in "Jack Aetos",
// "dragon" in "Dragons". Those names obviously refer to their entity and
// don't need LLM review even if statistically over-matching.
function nameMatchesEntityLabel(name: string, label: string): boolean {
  if (!label) return false;
  const n = normalizeForLabelMatch(name);
  const l = normalizeForLabelMatch(label);
  if (n.length === 0 || l.length === 0) return false;
  if (n === l) return true;
  return new RegExp(`\\b${RegExp.escape(n)}\\b`).test(l);
}

function countMatches(index: SearchIndex, name: string): number {
  const regex = nameRegex(name);
  let count = 0;
  while (regex.exec(index.fullText) !== null) count++;
  return count;
}

function samplePassages(index: SearchIndex, name: string, k: number): string[] {
  const regex = nameRegex(name);
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(index.fullText)) !== null) {
    positions.push(m.index);
  }
  if (positions.length === 0) return [];

  const samplesToReturn = Math.min(k, positions.length);
  const bucketSize = positions.length / samplesToReturn;

  const sampledPositions: number[] = [];
  for (let i = 0; i < samplesToReturn; i++) {
    const bucketStart = Math.floor(i * bucketSize);
    const bucketEnd = Math.floor((i + 1) * bucketSize);
    const bucketSlice = positions.slice(bucketStart, bucketEnd);
    const randomFromBucket = bucketSlice[Math.floor(Math.random() * bucketSlice.length)];
    sampledPositions.push(randomFromBucket);
  }

  const { fullText } = index;
  return sampledPositions.map((pos) => {
    const start = Math.max(0, pos - CONTEXT_CHARS);
    const end = Math.min(fullText.length, pos + name.length + CONTEXT_CHARS);
    let snippet = fullText.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < fullText.length) snippet = snippet + '...';
    const paragraphIdx = paragraphIdxAtOffset(index, pos);
    const pov =
      paragraphIdx !== null ? index.povByParagraphIdx.get(paragraphIdx) : undefined;
    return dedent`${formatPovTag(pov).trim()}
      ${snippet}`.trim();
  });
}

function findOutlierIndices(counts: number[]): Set<number> {
  if (counts.length < 3) return new Set();

  const logs = counts.map((c) => Math.log(c + 1));
  const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
  const variance = logs.reduce((s, v) => s + (v - mean) ** 2, 0) / logs.length;
  const std = Math.sqrt(variance);
  if (std === 0) return new Set();

  const outliers = new Set<number>();
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < MIN_REVIEW_COUNT) continue;
    const z = (logs[i] - mean) / std;
    if (z >= OUTLIER_LOG_Z) outliers.add(i);
  }
  return outliers;
}

export const handler = createWorkflowFunction<
  {
    bookImportId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  },
  { bookId: string; entitiesUpdated: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Remove Ambiguous Entity Names ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookImportId }) => {
      const bookImport = await getBookImportById(bookImportId);
      if (!bookImport) throw new UnrecoverableError('Book Import not found');
      if (!bookImport.bookId) throw new UnrecoverableError('Book ID not found');
      const book = await getBookById(bookImport.bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      return { book, bookImport };
    },
    check: async (_payload, result) => ({
      passed: result.entitiesUpdated >= 0,
      metadata: { entitiesUpdated: result.entitiesUpdated }
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
      .withMetadata({ bookId: book.id, bookTitle: book.title })
      .info('Starting remove ambiguous entity names');

    await ctx.narrate('Checking which entity names are too generic to identify anyone.');

    const allEntities = await getBookEntitiesByBookId(book.id);
    if (allEntities.length === 0) {
      return { bookId: book.id, entitiesUpdated: 0 };
    }

    const allParagraphs = await getNonEmptyChapterParagraphsByBookId(book.id);
    const allScenes = await getChapterScenesByBookId(book.id);
    const scenesWithParagraphs = organizeParagraphsIntoScenes(allScenes, allParagraphs);
    const searchIndex = buildSearchIndex(allParagraphs, scenesWithParagraphs);

    type Pair = {
      entityFriendlyId: string;
      entityLabel: string;
      entityDescription: string;
      name: string;
      count: number;
      autoKeep: boolean;
    };

    const pairs: Pair[] = [];
    const countCache = new Map<string, number>();
    for (const entity of allEntities) {
      const label = entity.label || entity.name;
      const names = entity.names || [];
      for (const name of names) {
        let count = countCache.get(name);
        if (count === undefined) {
          count = countMatches(searchIndex, name);
          countCache.set(name, count);
        }
        pairs.push({
          entityFriendlyId: entity.friendlyId,
          entityLabel: label,
          entityDescription: entity.description || 'unknown',
          name,
          count,
          autoKeep: nameMatchesEntityLabel(name, label)
        });
      }
    }

    if (pairs.length === 0) {
      ctx.log.info('No candidate names to review');
      return { bookId: book.id, entitiesUpdated: 0 };
    }

    const outlierIndices = findOutlierIndices(pairs.map((p) => p.count));
    for (const idx of Array.from(outlierIndices)) {
      if (pairs[idx].autoKeep) {
        ctx.log.info(
          `Auto-keeping outlier: ${pairs[idx].entityFriendlyId} (${pairs[idx].entityLabel}) — "${pairs[idx].name}" ×${pairs[idx].count} (name appears in label)`
        );
        outlierIndices.delete(idx);
      }
    }
    if (outlierIndices.size === 0) {
      ctx.log.info(`No outlier names need LLM review (scanned ${pairs.length} pairs)`);
      return { bookId: book.id, entitiesUpdated: 0 };
    }

    ctx.log.info(
      `Found ${outlierIndices.size} outlier (entity, name) pair${outlierIndices.size === 1 ? '' : 's'} needing LLM review out of ${pairs.length}`
    );

    const entries = Array.from(outlierIndices).map((idx) => {
      const p = pairs[idx];
      return {
        entityId: p.entityFriendlyId,
        entityLabel: p.entityLabel,
        entityDescription: p.entityDescription,
        name: p.name,
        matchCount: p.count,
        passages: samplePassages(searchIndex, p.name, SAMPLE_PASSAGES)
      };
    });

    for (const entry of entries) {
      ctx.log.info(
        `Outlier: ${entry.entityId} (${entry.entityLabel}) — "${entry.name}" ×${entry.matchCount}`
      );
    }

    const userText = determineOvermatchingEntityNamesPrompt.render({ entries });
    const { model, apiKey, reasoning } = ctx.getPiModel('piTextLight');
    const message = await ctx.traceComplete(
      'determineOvermatchingEntityNames',
      model,
      { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);

    const text = getAssistantText(message);
    const xml = extractWrappedXml(text, 'flagged');
    if (!xml) {
      ctx.log.warn(`No <flagged> block in response, skipping removals: ${text}`);
      return { bookId: book.id, entitiesUpdated: 0 };
    }

    const ast = parse(xml);
    const flaggedPairs = new Set<string>();
    for (const node of querySelectorAll(ast, 'pair')) {
      const id = getAttribute(node, 'id') || '';
      const name = getAttribute(node, 'name') || '';
      if (!id || !name) continue;
      flaggedPairs.add(`${id}|${name}`);
    }

    if (flaggedPairs.size === 0) {
      ctx.log.info('No names flagged for removal');
      return { bookId: book.id, entitiesUpdated: 0 };
    }

    const removalsByEntity = new Map<string, Set<string>>();
    for (const idx of outlierIndices) {
      const p = pairs[idx];
      const key = `${p.entityFriendlyId}|${p.name}`;
      if (!flaggedPairs.has(key)) continue;
      let set = removalsByEntity.get(p.entityFriendlyId);
      if (!set) {
        set = new Set();
        removalsByEntity.set(p.entityFriendlyId, set);
      }
      set.add(p.name);
    }

    const entityById = new Map(allEntities.map((e) => [e.friendlyId, e]));
    let entitiesUpdated = 0;
    await getDb()
      .transaction()
      .execute(async (trx) => {
        for (const [friendlyId, namesToRemove] of removalsByEntity) {
          const bookEntity = await getBookEntityByBookIdAndFriendlyId(
            book.id,
            friendlyId,
            trx
          );
          if (!bookEntity) {
            ctx.log.warn(`Entity ${friendlyId} not found in DB, skipping`);
            continue;
          }
          const original = entityById.get(friendlyId)?.names || [];
          let remaining = original.filter((n) => !namesToRemove.has(n));
          if (remaining.length === original.length) continue;

          if (remaining.length === 0) {
            const fallback = bookEntity.label || bookEntity.name;
            ctx.log.warn(
              `Entity ${friendlyId} (${fallback}) would have no names left after removing [${Array.from(namesToRemove).join(', ')}]; falling back to label`
            );
            remaining = [fallback];
          } else {
            ctx.log.info(
              `Entity ${friendlyId} (${bookEntity.label || bookEntity.name}): removed [${Array.from(namesToRemove).join(', ')}], ${original.length} → ${remaining.length} names`
            );
          }

          await updateBookEntityById(bookEntity.id, { names: remaining }, trx);
          entitiesUpdated++;
        }
      });

    ctx.log.info(
      `Updated ${entitiesUpdated} entit${entitiesUpdated === 1 ? 'y' : 'ies'}`
    );
    return { bookId: book.id, entitiesUpdated };
  }
);

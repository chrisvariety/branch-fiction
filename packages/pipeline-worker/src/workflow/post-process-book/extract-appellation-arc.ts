import {
  extractWrappedXml,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { NewBookArc } from '@/app/lib/db/types';
import { getDb } from '@/lib/db';
import {
  createBookArcs,
  createRawBookArc
} from '@/lib/db/models/book-arc/create-book-arc';
import {
  generateUniqueArcFriendlyPrefix,
  getBookArcsWithEntitiesByBookIdAndType
} from '@/lib/db/models/book-arc/get-book-arc';
import { getBookEntitiesByBookIdAndTypesAndSignificanceTiers } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getChapterEntityAppellationsWithChapterAndEntitiesByBookId } from '@/lib/db/models/chapter-entity-appellation/get-chapter-entity-appellation';
import { getChapterByBookIdAndChapterIdx } from '@/lib/db/models/chapter/get-chapter';
import { convertArcFriendlyIdPrefixToIsolated } from '@/lib/lit/arc-types';
import { parseChapterRange } from '@/lib/lit/chapter-range';
import extractAppellationArcPrompt from '@/lib/prompts/post-processing/extract-appellation-arc';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

export const handler = createWorkflowFunction<
  {
    bookId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
  },
  { bookId: string; arcsCreated: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Extract Appellation Arc ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { book };
    },
    check: async (_payload, result) => ({
      passed: result.arcsCreated >= 0,
      severity: 'WARN' as const,
      metadata: { arcsCreated: result.arcsCreated }
    })
  },
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting appellation arc extraction');

    await ctx.narrate(
      'Simultaneously, tracking how characters address each other over time.'
    );

    const appellations = await getChapterEntityAppellationsWithChapterAndEntitiesByBookId(
      book.id
    );

    const entityIds = (
      await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
        book.id,
        ['CHARACTER'],
        ['PRIMARY', 'SECONDARY']
      )
    ).map((entity) => entity.id);

    // Check for existing APPELLATION arcs and extract covered source→target pairs
    const existingArcs = await getBookArcsWithEntitiesByBookIdAndType(
      book.id,
      'APPELLATION'
    );

    // For appellation arcs, bookEntityIds is [sourceId, targetId] - order matters
    const coveredPairKeys = new Set(
      existingArcs.map((arc) => arc.bookEntityIds.join(','))
    );

    ctx.log.info(
      `Found ${existingArcs.length} existing appellation arcs covering ${coveredPairKeys.size} unique source→target pairs`
    );

    const entityFilteredAppellations = appellations.filter(
      (appellation) =>
        entityIds.includes(appellation.sourceEntity.id) &&
        entityIds.includes(appellation.targetEntity.id)
    );

    const sourcePhraseTargetCounts = new Map<string, Map<string, number>>();
    for (const appellation of entityFilteredAppellations) {
      const sourcePhraseKey = `${appellation.sourceEntity.id}|${appellation.phrase}`;
      if (!sourcePhraseTargetCounts.has(sourcePhraseKey)) {
        sourcePhraseTargetCounts.set(sourcePhraseKey, new Map());
      }
      const targetCounts = sourcePhraseTargetCounts.get(sourcePhraseKey)!;
      targetCounts.set(
        appellation.targetEntity.id,
        (targetCounts.get(appellation.targetEntity.id) || 0) + 1
      );
    }

    // For each source+phrase, find the dominant target (if one exists with >75% of uses)
    const sourcPhraseDominantTarget = new Map<string, string | null>();
    for (const [sourcePhraseKey, targetCounts] of sourcePhraseTargetCounts) {
      const total = Array.from(targetCounts.values()).reduce((a, b) => a + b, 0);
      let dominantTarget: string | null = null;
      for (const [targetId, count] of targetCounts) {
        if (count / total > 0.75) {
          dominantTarget = targetId;
          break;
        }
      }
      sourcPhraseDominantTarget.set(sourcePhraseKey, dominantTarget);
    }

    // Filter out minority attributions
    const filteredAppellations = entityFilteredAppellations.filter((appellation) => {
      const sourcePhraseKey = `${appellation.sourceEntity.id}|${appellation.phrase}`;
      const dominantTarget = sourcPhraseDominantTarget.get(sourcePhraseKey);
      return dominantTarget === null || appellation.targetEntity.id === dominantTarget;
    });

    ctx.log.info(
      `Filtered ${entityFilteredAppellations.length - filteredAppellations.length} likely misattributed appellations`
    );

    const groupedAppellations = Object.values(
      filteredAppellations.reduce<
        Record<
          string,
          {
            sourceBookEntityId: string;
            sourceBookEntityName: string;
            targetBookEntityId: string;
            targetBookEntityName: string;
            phrase: string;
            type: string;
            phraseCount: number;
            contexts: string[];
            chapterIdxs: number[];
          }
        >
      >((acc, appellation) => {
        const key = `${appellation.sourceEntity.id}|${appellation.targetEntity.id}|${appellation.phrase}`;

        if (!acc[key]) {
          acc[key] = {
            sourceBookEntityId: appellation.sourceEntity.id,
            sourceBookEntityName: appellation.sourceEntity.name,
            targetBookEntityId: appellation.targetEntity.id,
            targetBookEntityName: appellation.targetEntity.name,
            phrase: appellation.phrase,
            type: appellation.type,
            phraseCount: 0,
            contexts: [],
            chapterIdxs: []
          };
        }

        acc[key].phraseCount++;
        acc[key].contexts.push(appellation.context);
        if (!acc[key].chapterIdxs.includes(appellation.chapter.idx)) {
          acc[key].chapterIdxs.push(appellation.chapter.idx);
        }

        return acc;
      }, {})
    );

    // Group by source|target to analyze what makes each pair "interesting"
    const pairStats = new Map<
      string,
      { phraseCount: number; hasNonGivenName: boolean }
    >();
    for (const group of groupedAppellations) {
      const pairKey = `${group.sourceBookEntityId}|${group.targetBookEntityId}`;
      const stats = pairStats.get(pairKey) || { phraseCount: 0, hasNonGivenName: false };
      stats.phraseCount++;
      if (group.type !== 'GIVEN_NAME') {
        stats.hasNonGivenName = true;
      }
      pairStats.set(pairKey, stats);
    }

    const interestingPairKeys = new Set<string>();
    for (const [pairKey, stats] of pairStats) {
      if (stats.phraseCount > 1 || stats.hasNonGivenName) {
        interestingPairKeys.add(pairKey);
      }
    }

    const newPairKeys = new Set<string>();
    for (const pairKey of interestingPairKeys) {
      const [sourceId, targetId] = pairKey.split('|');
      const coveredKey = `${sourceId},${targetId}`;
      if (!coveredPairKeys.has(coveredKey)) {
        newPairKeys.add(pairKey);
      }
    }

    ctx.log.info(
      `Found ${newPairKeys.size} new interesting pairs without arc coverage (${interestingPairKeys.size - newPairKeys.size} already covered)`
    );

    if (newPairKeys.size === 0) {
      ctx.log.info(
        'All interesting pairs already have arc coverage - skipping extraction'
      );
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    // Filter to only interesting appellations from new pairs
    const interestingAppellations = groupedAppellations.filter((group) => {
      const pairKey = `${group.sourceBookEntityId}|${group.targetBookEntityId}`;
      return newPairKeys.has(pairKey);
    });

    ctx.log.info(
      `Filtered ${groupedAppellations.length} grouped appellations to ${interestingAppellations.length} interesting ones from new pairs`
    );

    const arcsToInsert: Array<
      Omit<NewBookArc, 'friendlyIdPrefix' | 'friendlyId' | 'friendlyIdIdx'>
    > = [];

    // Send interesting appellations to the LLM for analysis
    let appellationArcResult: Awaited<ReturnType<typeof extractAppellationArc>> = [];

    if (interestingAppellations.length > 0) {
      const maxChapterIdx = Math.max(...filteredAppellations.map((a) => a.chapter.idx));

      const pairsMap = new Map<
        string,
        {
          sourceEntityId: string;
          source: { friendlyId: string; name: string; label?: string };
          targetEntityId: string;
          target: { friendlyId: string; name: string; label?: string };
          appellations: Map<
            string,
            {
              phrase: string;
              type: string;
              chapterIdxs: number[];
              totalCount: number;
              contexts: Array<{ chapterIdx: number; text: string }>;
            }
          >;
        }
      >();

      // Use raw filtered appellations to preserve chapter<->context mapping
      for (const appellation of filteredAppellations) {
        const pairKey = `${appellation.sourceEntity.id}|${appellation.targetEntity.id}`;

        // Only include appellations from new interesting pairs
        if (!newPairKeys.has(pairKey)) continue;

        if (!pairsMap.has(pairKey)) {
          pairsMap.set(pairKey, {
            sourceEntityId: appellation.sourceEntity.id,
            source: {
              friendlyId: appellation.sourceEntity.friendlyId,
              name: appellation.sourceEntity.name,
              label: appellation.sourceEntity.label ?? undefined
            },
            targetEntityId: appellation.targetEntity.id,
            target: {
              friendlyId: appellation.targetEntity.friendlyId,
              name: appellation.targetEntity.name,
              label: appellation.targetEntity.label ?? undefined
            },
            appellations: new Map()
          });
        }

        const pair = pairsMap.get(pairKey)!;
        // Group by phrase only (not chapter|phrase)
        const appellationKey = appellation.phrase;

        if (!pair.appellations.has(appellationKey)) {
          pair.appellations.set(appellationKey, {
            phrase: appellation.phrase,
            type: appellation.type,
            chapterIdxs: [],
            totalCount: 0,
            contexts: []
          });
        }

        const appellationEntry = pair.appellations.get(appellationKey)!;
        appellationEntry.totalCount++;
        if (!appellationEntry.chapterIdxs.includes(appellation.chapter.idx)) {
          appellationEntry.chapterIdxs.push(appellation.chapter.idx);
        }
        appellationEntry.contexts.push({
          chapterIdx: appellation.chapter.idx,
          text: appellation.context
        });
      }

      // Convert to array format with chapter ranges, sorted by first chapter appearance
      const pairs = Array.from(pairsMap.values()).map((pair) => ({
        sourceEntityId: pair.sourceEntityId,
        source: pair.source,
        targetEntityId: pair.targetEntityId,
        target: pair.target,
        appellations: Array.from(pair.appellations.values())
          .map((a) => ({
            phrase: a.phrase,
            type: a.type,
            chapters: formatChapterRange(a.chapterIdxs.sort((x, y) => x - y)),
            totalCount: a.totalCount,
            contexts: a.contexts.sort((x, y) => x.chapterIdx - y.chapterIdx)
          }))
          .sort((a, b) => {
            // Sort by first chapter appearance
            const aFirst = a.contexts[0]?.chapterIdx ?? 0;
            const bFirst = b.contexts[0]?.chapterIdx ?? 0;
            return aFirst - bFirst;
          })
      }));

      if (pairs.length > 0) {
        const pairFriendlyIdToEntityIds = new Map<string, [string, string]>();
        for (const pair of pairs) {
          pairFriendlyIdToEntityIds.set(
            `${pair.source.friendlyId}|${pair.target.friendlyId}`,
            [pair.sourceEntityId, pair.targetEntityId]
          );
        }

        appellationArcResult = await extractAppellationArc(
          {
            book,
            pairs,
            maxChapterIdx
          },
          ctx
        );

        // Add LLM results to arcsToInsert
        for (const arc of appellationArcResult) {
          const entityIds = pairFriendlyIdToEntityIds.get(
            `${arc.sourceId}|${arc.targetId}`
          );
          if (!entityIds) {
            throw new RecoverableError(
              `Could not find entity IDs for source: ${arc.sourceId}, target: ${arc.targetId}`
            );
          }

          arcsToInsert.push({
            id: uuidv7(),
            bookId: book.id,
            type: 'APPELLATION',
            startChapterId: arc.startChapterId,
            endChapterId: arc.endChapterId,
            title: arc.title,
            content: arc.content,
            bookEntityIds: entityIds
          });
        }
      }
    }

    ctx.log.info(`Generated ${appellationArcResult.length} appellation arcs from LLM`);

    if (arcsToInsert.length === 0) {
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    const arcsByEntityIds = new Map<string, typeof arcsToInsert>();
    for (const arc of arcsToInsert) {
      const key = arc.bookEntityIds.join(',');
      if (!arcsByEntityIds.has(key)) {
        arcsByEntityIds.set(key, []);
      }
      arcsByEntityIds.get(key)!.push(arc);
    }

    // Insert arcs in a transaction
    const createdArcs = await getDb()
      .transaction()
      .execute(async (trx) => {
        const allArcs: Awaited<ReturnType<typeof createBookArcs>> = [];

        // Process each group of arcs with the same entity IDs
        for (const arcsGroup of arcsByEntityIds.values()) {
          // Generate prefix for this group
          const friendlyIdPrefix = await generateUniqueArcFriendlyPrefix({
            bookId: book.id,
            arcType: 'APPELLATION',
            entityIds: arcsGroup[0].bookEntityIds,
            trx
          });

          const arcs = await createBookArcs(arcsGroup, friendlyIdPrefix, trx);
          allArcs.push(...arcs);

          // Create ISOLATED versions of each arc
          for (const arc of arcs) {
            const isolatedArc = await createRawBookArc(
              {
                id: uuidv7(),
                bookId: arc.bookId,
                type: 'APPELLATION_ISOLATED',
                friendlyIdIdx: arc.friendlyIdIdx,
                friendlyIdPrefix: convertArcFriendlyIdPrefixToIsolated(friendlyIdPrefix),
                bookEntityIds: arc.bookEntityIds,
                startChapterId: arc.startChapterId,
                endChapterId: arc.endChapterId,
                title: arc.title,
                content: arc.content // Copy as-is, prompt already instructs them to be isolated
              },
              trx
            );
            if (isolatedArc) {
              allArcs.push(isolatedArc);
            }
          }
        }

        return allArcs;
      });

    ctx.log.info(`Created ${createdArcs.length} appellation arcs`);

    return {
      bookId: book.id,
      arcsCreated: createdArcs.length
    };
  }
);

const AppellationArcOutputSchema = v.object({
  arcs: v.array(
    v.object({
      sourceId: v.string(),
      targetId: v.string(),
      phase: v.string(),
      chapters: v.string(),
      detail: v.string()
    })
  )
});

async function extractAppellationArc(
  {
    book,
    pairs,
    maxChapterIdx
  }: {
    book: { id: string; title: string };
    pairs: Array<{
      sourceEntityId: string;
      source: { friendlyId: string; name: string; label?: string };
      targetEntityId: string;
      target: { friendlyId: string; name: string; label?: string };
      appellations: Array<{
        phrase: string;
        type: string;
        chapters: string;
        totalCount: number;
        contexts: Array<{ chapterIdx: number; text: string }>;
      }>;
    }>;
    maxChapterIdx: number;
  },
  ctx: WorkflowContext
) {
  const userText = extractAppellationArcPrompt.render({ pairs });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'extractAppellationArc',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, 'appellation_arcs');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new UnrecoverableError('No appellation arcs found in response');
  }
  ctx.log.info(`Agent: captured <appellation_arcs> (length: ${xml.length})`);

  const ast = parse(xml);
  const arcNodes = querySelectorAll(ast, 'arc');

  const data = {
    arcs: arcNodes.map((arc) => ({
      sourceId: getText(querySelector(arc, 'source_id')).trim(),
      targetId: getText(querySelector(arc, 'target_id')).trim(),
      phase: getText(querySelector(arc, 'phase')).trim(),
      chapters: getText(querySelector(arc, 'chapters')).trim(),
      detail: getText(querySelector(arc, 'detail')).trim()
    }))
  };

  const validatedData = v.safeParse(AppellationArcOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse appellation arc snapshots: ${v.summarize(validatedData.issues)}`
    );
  }

  if (validatedData.output.arcs.length === 0) {
    throw new RecoverableError('No appellation arcs found in response');
  }

  const mappedData: {
    sourceId: string;
    targetId: string;
    startChapterId: string;
    endChapterId: string;
    content: string;
    title: string;
  }[] = [];

  for (const arc of validatedData.output.arcs) {
    const chapterRange = parseChapterRange(arc.chapters, maxChapterIdx);

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
        `Could not find chapters for range ${arc.chapters} (${chapterRange.startChapterIdx}-${chapterRange.endChapterIdx})`
      );
    }

    mappedData.push({
      sourceId: arc.sourceId,
      targetId: arc.targetId,
      startChapterId: startChapter.id,
      endChapterId: endChapter.id,
      content: arc.detail,
      title: arc.phase
    });
  }

  return mappedData;
}

function formatChapterRange(chapters: number[]): string {
  if (chapters.length === 0) return '';
  if (chapters.length === 1) return String(chapters[0]);

  const ranges: string[] = [];
  let rangeStart = chapters[0];
  let rangeEnd = chapters[0];

  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i] === rangeEnd + 1) {
      // Extend current range
      rangeEnd = chapters[i];
    } else {
      // End current range, start new one
      ranges.push(
        rangeStart === rangeEnd ? String(rangeStart) : `${rangeStart}-${rangeEnd}`
      );
      rangeStart = chapters[i];
      rangeEnd = chapters[i];
    }
  }

  // Add final range
  ranges.push(rangeStart === rangeEnd ? String(rangeStart) : `${rangeStart}-${rangeEnd}`);

  return ranges.join(', ');
}

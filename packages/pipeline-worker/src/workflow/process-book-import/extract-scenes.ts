import { watchAgent } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import dedent from 'dedent';
import { v7 as uuidv7 } from 'uuid';

import { NewChapterScene } from '@/app/lib/db/types';
import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { createChapterSceneGroups } from '@/lib/db/models/chapter-scene-group/create-chapter-scene-group';
import { createChapterScenes } from '@/lib/db/models/chapter-scene/create-chapter-scene';
import { getChapterScenesByBookId } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { getMaxChapterIdxByBookId } from '@/lib/db/models/chapter/get-chapter';
import {
  extractProcessedChapters,
  findMissingChapterRange,
  minChaptersToRead
} from '@/lib/lit/book-content';
import { computeChapterSceneGroups } from '@/lib/lit/chapter-scene-groups';
import {
  splitByThematicBreak,
  ThematicBreakGroup
} from '@/lib/lit/split-by-thematic-break';
import { estimateTokens } from '@/lib/llm/estimate-tokens';
import extractScenesPrompt from '@/lib/prompts/import/extract-scenes';
import { reportStepProgress } from '@/lib/step-projection';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

// Stop after this many consecutive rounds with no new chapters completed.
const MAX_STALLED_ROUNDS = 3;

const CONTEXT_LIMIT_TOKENS = 128_000;
const CONTEXT_HEADROOM_TOKENS = 20_000;
const PREVIEW_CONTEXT_BUDGET_TOKENS = 40_000;

// potential improvement: `title` is effectively write-only (only finalize-scenes reads it as a
// hint). Drop it or repurpose the slot for a scene summary / plot beat that downstream
// prompts (post-processing, chat, even a 'plot' arc) could actually consume -- it's a natural home for plot/scene-level
// data. Separately, replace `locationBookEntityId` / `settingBookEntityId` columns on
// `chapter_scenes` with a `chapter_scene_locations` join table — scenes routinely span 2-4
// places, so single-value columns force an arbitrary reduction. Setting could then derive from
// hierarchy ancestry rather than being a stored column.
//
// need to figure out the focus of the scene summary though - what's it helping downstream?
// I was thinking _appearance_ arcs mostly, e.g. "what did they wear to the ball?"

export const handler = createWorkflowFunction<
  {
    bookImportId: string;
    roundCap?: number;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
    roundCap?: number;
  },
  { bookId: string; sceneCount: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Extract Scenes ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookImportId, roundCap }) => {
      const bookImport = await getBookImportById(bookImportId);
      if (!bookImport) throw new UnrecoverableError('Book Import not found');
      if (!bookImport.bookId) throw new UnrecoverableError('Book ID not found');
      const book = await getBookById(bookImport.bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      return { book, bookImport, roundCap };
    },
    check: async (_payload, result) => ({
      passed: result.sceneCount > 0,
      metadata: { sceneCount: result.sceneCount }
    }),
    onFailure: async (_, error) => {
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ book, roundCap }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting scene extraction');

    if (!roundCap) {
      await ctx.narrate(
        'Reading chapter by chapter, marking where scenes begin and end.'
      );
    }

    const maxChapter = await getMaxChapterIdxByBookId(book.id);

    const allParagraphs = await getNonEmptyChapterParagraphsByBookId(book.id);

    const paragraphsByChapter = allParagraphs.reduce((acc, paragraph) => {
      if (!acc.has(paragraph.chapterIdx)) {
        acc.set(paragraph.chapterIdx, []);
      }
      acc.get(paragraph.chapterIdx)!.push(paragraph);
      return acc;
    }, new Map<number, typeof allParagraphs>());

    // there are no thematic breaks between chapters, so instead, we process each chapter separately
    const allThematicBreakGroups: ThematicBreakGroup[] = [];
    let currentFriendlyId = 1;

    for (const chapterParagraphs of paragraphsByChapter.values()) {
      const thematicBreakGroups = splitByThematicBreak(
        chapterParagraphs,
        currentFriendlyId
      );
      if (!thematicBreakGroups.length) {
        throw new UnrecoverableError(
          `No thematic breaks found for chapter ${chapterParagraphs[0].chapterIdx}`
        );
      }

      allThematicBreakGroups.push(...thematicBreakGroups);
      currentFriendlyId =
        thematicBreakGroups[thematicBreakGroups.length - 1].friendlyId + 1;
    }

    const bookTokens = allParagraphs.reduce(
      (sum, p) => sum + estimateTokens(p.content),
      0
    );

    const { scenes, preExistingFriendlyIds, allChaptersProcessed } = await extractScenes(
      {
        bookId: book.id,
        allParagraphs,
        maxChapter,
        allThematicBreakGroups,
        bookTokens,
        roundCap
      },
      ctx
    );

    if (scenes.length === 0) {
      throw new RecoverableError(`No scenes found for book ${book.id}`);
    }

    if (!roundCap) {
      const excludedPovs = new Set(['Unknown', 'Omniscient Narrator']);
      const uniquePovNames = Array.from(
        new Set(scenes.map((s) => s.povCharacter).filter((p) => !excludedPovs.has(p)))
      );
      const chapterCount = new Set(
        scenes
          .map((s) =>
            allParagraphs.find((p) => p.bookParagraphIdx === s.startBookParagraphIdx)
          )
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map((p) => p.chapterIdx)
      ).size;
      const narratorPart =
        uniquePovNames.length > 0
          ? ` ~${uniquePovNames.length} distinct ${uniquePovNames.length === 1 ? 'narrator' : 'narrators'}.`
          : '';
      await ctx.narrate(
        `${scenes.length} scenes across ${chapterCount} chapters.${narratorPart}`
      );
    }

    const chapterScenes: NewChapterScene[] = [];

    for (const scene of scenes) {
      if (preExistingFriendlyIds.has(scene.friendlyId)) continue;
      const startParagraph = allParagraphs.find(
        (p) => p.bookParagraphIdx === scene.startBookParagraphIdx
      );
      const endParagraph = allParagraphs.find(
        (p) => p.bookParagraphIdx === scene.endBookParagraphIdx
      );
      if (!startParagraph) {
        throw new RecoverableError(
          `Start Paragraph not found for scene ${startParagraph}, was the bookParagraphIdx hallucinated?`
        );
      }
      if (!endParagraph) {
        throw new RecoverableError(
          `End Paragraph not found for scene ${endParagraph}, was the bookParagraphIdx hallucinated?`
        );
      }

      chapterScenes.push({
        id: uuidv7(),
        isPreliminary: true,
        chapterId: startParagraph.chapterId,
        bookId: book.id,
        startChapterParagraphId: startParagraph.id,
        endChapterParagraphId: endParagraph.id,
        povBookEntityId: null, // filled in at finalization
        title: scene.title,
        pov: scene.pov,
        povEntity: scene.povCharacter,
        location: scene.location ?? null,
        setting: scene.setting ?? null,
        locationBookEntityId: null, // filled in at finalization
        settingBookEntityId: null // filled in at finalization
      });
    }

    await createChapterScenes(chapterScenes);

    if (allChaptersProcessed) {
      const allScenesForGroups = await getChapterScenesByBookId(book.id);
      const sceneGroups = computeChapterSceneGroups(allScenesForGroups, allParagraphs);
      const sceneById = new Map(allScenesForGroups.map((s) => [s.id, s]));

      await createChapterSceneGroups(
        sceneGroups.map((sceneIds, idx) => {
          const groupScenes = sceneIds.map((id) => sceneById.get(id)!);
          return {
            id: uuidv7(),
            bookId: book.id,
            idx,
            startChapterId: groupScenes[0].chapterId,
            endChapterId: groupScenes[groupScenes.length - 1].chapterId,
            chapterSceneIds: sceneIds
          };
        })
      );

      ctx.log.info(
        `Created ${sceneGroups.length} scene groups from ${allScenesForGroups.length} scenes`
      );
    } else {
      ctx.log.info(
        `Skipping scene group creation (partial run; will be created once all chapters are processed)`
      );
    }

    return {
      bookId: book.id,
      sceneCount: scenes.length
    };
  }
);

const SetSceneDetailsSchema = Type.Object({
  number: Type.Number({
    minimum: 1,
    description: 'Scene number from book_chapter_content'
  }),
  chapterIdx: Type.Number({
    minimum: 1,
    description: 'Chapter number where this scene appears'
  }),
  povCharacter: Type.String({
    description: 'POV Character name, "Omniscient Narrator", or "Unknown"'
  }),
  pov: Type.Union(
    [
      Type.Literal('first-person'),
      Type.Literal('second-person'),
      Type.Literal('third-person limited'),
      Type.Literal('third-person omniscient')
    ],
    { description: 'Narrative point of view' }
  ),
  title: Type.String({ description: 'Descriptive scene title' }),
  location: Type.Optional(
    Type.String({ description: 'The immediate, specific place where action occurs' })
  ),
  setting: Type.Optional(
    Type.String({ description: 'The broader geographical or contextual area' })
  )
});

type SceneDetails = {
  friendlyId: number;
  povCharacter: string;
  pov:
    | 'first-person'
    | 'second-person'
    | 'third-person limited'
    | 'third-person omniscient';
  title: string;
  location?: string;
  setting?: string;
  chapterIdx: number;
};

async function extractScenes(
  {
    bookId,
    allParagraphs,
    maxChapter,
    allThematicBreakGroups,
    bookTokens,
    roundCap
  }: {
    bookId: string;
    allParagraphs: Awaited<ReturnType<typeof getNonEmptyChapterParagraphsByBookId>>;
    maxChapter: number;
    allThematicBreakGroups: ThematicBreakGroup[];
    bookTokens: number;
    roundCap?: number;
  },
  ctx: WorkflowContext
) {
  const thematicBreakGroupsByChapterIdx = allThematicBreakGroups.reduce(
    (acc, thematicBreakGroup) => {
      const chapterIdx = thematicBreakGroup.chapterIdx;
      if (acc.has(chapterIdx)) {
        acc.get(chapterIdx)!.push(thematicBreakGroup);
      } else {
        acc.set(chapterIdx, [thematicBreakGroup]);
      }
      return acc;
    },
    new Map<number, ThematicBreakGroup[]>()
  );

  // Map to store all scenes by friendlyId
  const sceneMap = new Map<number, SceneDetails>();

  const bookChapterContentSchema = Type.Object({
    chapterIdx: Type.Number({
      minimum: 1,
      maximum: maxChapter,
      description: `The chapter number to read (1-${maxChapter})`
    })
  });

  const bookChapterContentTool: AgentTool<typeof bookChapterContentSchema> = {
    name: 'book_chapter_content',
    label: 'Read Chapter',
    description: 'Get the content of a specific chapter from a book',
    parameters: bookChapterContentSchema,
    execute: async (_id, args) => {
      const chapterIdxNum = args.chapterIdx;

      if (!thematicBreakGroupsByChapterIdx.has(chapterIdxNum)) {
        ctx.log.error(`Chapter ${chapterIdxNum} not found`);
        ctx.log.error(
          `Available chapters: ${Array.from(thematicBreakGroupsByChapterIdx.keys()).join(', ')}`
        );
        throw new Error(`Chapter ${chapterIdxNum} not found`);
      }

      const text =
        thematicBreakGroupsByChapterIdx
          .get(chapterIdxNum)!
          .map((thematicBreakGroup) => {
            return dedent`<scene n="${thematicBreakGroup.friendlyId}">
        ${thematicBreakGroup.content.join('\n')}
        </scene>`;
          })
          .join('\n\n') || '(chapter is empty)';

      return { content: [{ type: 'text', text }], details: {} };
    }
  };

  const setSceneDetailsTool: AgentTool<typeof SetSceneDetailsSchema> = {
    name: 'set_scene_details',
    label: 'Set Scene Details',
    description: 'Set the details for a specific scene',
    parameters: SetSceneDetailsSchema,
    execute: async (_id, args) => {
      // Validate that the friendlyId exists in thematic break groups
      const thematicBreakGroup = allThematicBreakGroups.find(
        (g) => g.friendlyId === args.number
      );

      if (!thematicBreakGroup) {
        const errorMsg = `Scene number ${args.number} is invalid. Please try again with a valid scene number.`;
        ctx.log.warn(errorMsg);
        throw new Error(errorMsg);
      }

      if (thematicBreakGroup.chapterIdx !== args.chapterIdx) {
        const errorMsg = `Scene ${args.number} belongs to chapter ${thematicBreakGroup.chapterIdx}, not chapter ${args.chapterIdx}. Please re-analyze the scene to ensure the details are correct and try again.`;
        ctx.log.warn(errorMsg);
        throw new Error(errorMsg);
      }

      const sceneDetails: SceneDetails = {
        friendlyId: args.number,
        povCharacter: args.povCharacter,
        pov: args.pov,
        title: args.title,
        location: args.location,
        setting: args.setting,
        chapterIdx: args.chapterIdx
      };

      const excludedPovs = new Set(['Unknown', 'Omniscient Narrator']);
      const priorPovs = new Set(
        Array.from(sceneMap.values())
          .map((s) => stripParenthetical(s.povCharacter))
          .filter((p) => !excludedPovs.has(p))
      );
      sceneMap.set(args.number, sceneDetails);
      ctx.log.info(
        `✓ Set details for scene ${args.number}: "${args.title}" (${args.povCharacter}, ${args.pov})`
      );

      const currentPov = stripParenthetical(args.povCharacter);
      if (!roundCap && !excludedPovs.has(currentPov) && !priorPovs.has(currentPov)) {
        const uniquePovs = Array.from(
          new Set(
            Array.from(sceneMap.values())
              .map((s) => stripParenthetical(s.povCharacter))
              .filter((p) => !excludedPovs.has(p))
          )
        ).filter((pov, _i, arr) => {
          // Exclude entries whose first word is shared with another entry — e.g. "John" when
          // "John Doe" is also present — to avoid "John and John Doe" outputs.
          const firstWord = pov.split(' ')[0];
          return !arr.some((other) => other !== pov && other.startsWith(firstWord));
        });
        if (uniquePovs.length === 1) {
          await ctx.narrate(`From the point of view of... ${args.povCharacter}?`);
        } else if (uniquePovs.length === 2) {
          await ctx.narrate(`${uniquePovs[0]} and ${uniquePovs[1]}. Dual POV, maybe?`);
        } else if (uniquePovs.length === 3) {
          await ctx.narrate(`An ensemble: ${uniquePovs.join(', ')}…`);
        } else if (uniquePovs.length === 5 || uniquePovs.length === 8) {
          await ctx.narrate(
            `${uniquePovs.length} narrators now — the cast keeps growing.`
          );
        }
      }

      return {
        content: [
          { type: 'text', text: `Successfully set details for scene ${args.number}` }
        ],
        details: {}
      };
    }
  };

  const allChapterIdxsProcessed: Set<number> = new Set();
  const preExistingFriendlyIds = new Set<number>();

  // Seed sceneMap from any existing chapter_scenes (e.g. from a previous preview run).
  const existingScenes = await getChapterScenesByBookId(bookId);
  if (existingScenes.length > 0) {
    const paragraphById = new Map(allParagraphs.map((p) => [p.id, p]));
    const tbgByStartBookParagraphIdx = new Map(
      allThematicBreakGroups.map((g) => [g.startBookParagraphIdx, g])
    );
    for (const s of existingScenes) {
      const startParagraph = paragraphById.get(s.startChapterParagraphId);
      if (!startParagraph) continue;
      const tbg = tbgByStartBookParagraphIdx.get(startParagraph.bookParagraphIdx);
      if (!tbg) continue;
      sceneMap.set(tbg.friendlyId, {
        friendlyId: tbg.friendlyId,
        povCharacter: s.povEntity,
        pov: s.pov as SceneDetails['pov'],
        title: s.title,
        location: s.location ?? undefined,
        setting: s.setting ?? undefined,
        chapterIdx: tbg.chapterIdx
      });
      preExistingFriendlyIds.add(tbg.friendlyId);
    }
    for (const [chapterIdx, tbgs] of thematicBreakGroupsByChapterIdx) {
      if (tbgs.every((g) => sceneMap.has(g.friendlyId))) {
        allChapterIdxsProcessed.add(chapterIdx);
      }
    }
    ctx.log.info(
      `Seeded ${preExistingFriendlyIds.size} pre-existing scenes (${allChapterIdxsProcessed.size} complete chapters) from prior run.`
    );
  }

  let round = 0;
  let stalledRounds = 0;
  const narratedMilestones = new Set<string>();
  let progressLine: Awaited<ReturnType<typeof ctx.narrate>> | null = null;
  const stepStartMs = Date.now();

  const tokenBudget =
    roundCap !== undefined
      ? PREVIEW_CONTEXT_BUDGET_TOKENS
      : CONTEXT_LIMIT_TOKENS - CONTEXT_HEADROOM_TOKENS;

  while (stalledRounds < MAX_STALLED_ROUNDS) {
    round++;
    ctx.log.info(`\n=== Scene Extraction Round ${round} ===`);

    const missingRange = findMissingChapterRange(
      Array.from(allChapterIdxsProcessed),
      maxChapter
    );

    if (!missingRange) {
      ctx.log.info('All chapters have been processed for scenes!');
      break;
    }

    const contextInfo = missingRange.contextChapter
      ? ` (with chapter ${missingRange.contextChapter} for context)`
      : '';
    ctx.log.info(
      `Processing chapters ${missingRange.start} to ${missingRange.end} for scenes${contextInfo}`
    );

    const userText = extractScenesPrompt.render({
      maxChapter,
      startChapter: missingRange.start,
      endChapter: missingRange.end,
      contextChapter: missingRange.contextChapter,
      existingScenes: sceneMap.size > 0 ? summarizeExistingScenes(sceneMap) : undefined,
      minChaptersToRead: minChaptersToRead(missingRange)
    });

    const { model, apiKey, reasoning } = ctx.getPiModel('piText');
    const agent = new Agent({
      sessionId: uuidv7(),
      initialState: {
        model,
        thinkingLevel: reasoning,
        tools: [bookChapterContentTool, setSceneDetailsTool]
      },
      getApiKey: () => apiKey
    });

    const watcher = watchAgent('extractScenes', agent, ctx);

    let budgetAborted = false;
    const roundStartSceneCount = sceneMap.size;
    agent.subscribe((event) => {
      if (event.type !== 'turn_end' || event.message.role !== 'assistant') return;
      const usage = event.message.usage;
      if (!usage) return;
      const contextTokens = usage.cacheRead + usage.input + usage.output;
      // turn_end fires after the turn's set_scene_details calls have executed, and we only abort once the round has recorded at least one scene.
      // that means a round can never stop without making forward progress, even on an oversized chapter.
      if (contextTokens > tokenBudget && sceneMap.size > roundStartSceneCount) {
        budgetAborted = true;
        ctx.log.warn(
          `Round ${round} hit context budget (${contextTokens}/${tokenBudget} tokens); aborting to roll over.`
        );
        agent.abort();
      }
    });

    try {
      await agent.prompt(userText);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        ctx.log.warn('Scene extraction aborted');
      } else {
        throw e;
      }
    }

    if (agent.state.errorMessage) {
      ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
    }

    // Detect chapters read without a set_scene_details call and nudge the model before counting the round.
    const setSceneChapterIdxs = new Set(
      watcher.toolCalls
        .filter((tc) => tc.name === 'set_scene_details')
        .map((tc) => tc.args.chapterIdx as number)
    );
    const skippedChapters = Array.from(
      new Set(
        watcher.toolCalls
          .filter((tc) => tc.name === 'book_chapter_content')
          .map((tc) => tc.args.chapterIdx as number)
          .filter(
            (ch) => ch !== missingRange.contextChapter && !setSceneChapterIdxs.has(ch)
          )
      )
    ).sort((a, b) => a - b);
    if (!budgetAborted && skippedChapters.length > 0) {
      const chapterList = skippedChapters.join(', ');
      const plural = skippedChapters.length === 1 ? '' : 's';
      ctx.log.warn(
        `Agent read chapter${plural} ${chapterList} but did not call set_scene_details for ${skippedChapters.length === 1 ? 'it' : 'them'}. Re-prompting.`
      );
      try {
        await agent.prompt(
          dedent`You read chapter${plural} ${chapterList} but did not call the \`set_scene_details\` tool for ${skippedChapters.length === 1 ? 'it' : 'them'}.
You must invoke the \`set_scene_details\` tool once per scene to record it.
Please call \`set_scene_details\` now for every scene in chapter${plural} ${chapterList}.`
        );
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          ctx.log.warn('Scene extraction nudge aborted');
        } else {
          throw e;
        }
      }
    }

    const processedChapters = extractProcessedChapters(watcher.toolCalls);
    ctx.log.info(`Chapters read this round: ${processedChapters.join(', ')}`);

    // Get all scenes from the scene map and sort by friendlyId
    const allScenesArray = Array.from(sceneMap.values()).sort(
      (a, b) => a.friendlyId - b.friendlyId
    );

    // Find unique chapters that have scenes
    const uniqueChapters = Array.from(
      new Set(allScenesArray.map((s) => s.chapterIdx))
    ).sort((a, b) => a - b);

    // Determine which chapters are complete (have all expected scenes)
    const completeChapters: number[] = [];
    for (const chapterIdx of uniqueChapters) {
      // Skip if already processed
      if (allChapterIdxsProcessed.has(chapterIdx)) {
        continue;
      }

      const thematicBreakGroups = thematicBreakGroupsByChapterIdx.get(chapterIdx);
      if (!thematicBreakGroups) {
        continue;
      }

      const expectedFriendlyIds = new Set(thematicBreakGroups.map((g) => g.friendlyId));
      const chapterScenes = allScenesArray.filter((s) => s.chapterIdx === chapterIdx);
      const actualFriendlyIds = new Set(chapterScenes.map((s) => s.friendlyId));

      // Check if all expected friendly IDs are present
      const isComplete = Array.from(expectedFriendlyIds).every((expectedId) =>
        actualFriendlyIds.has(expectedId)
      );

      if (isComplete) {
        completeChapters.push(chapterIdx);
      } else {
        // Stop at first incomplete chapter
        break;
      }
    }

    if (completeChapters.length > 0) {
      ctx.log.info(`Completed chapters this round: ${completeChapters.join(', ')}`);
      for (const chapterIdx of completeChapters) {
        allChapterIdxsProcessed.add(chapterIdx);
      }
      stalledRounds = 0;
      if (!roundCap) {
        const maxCompleted = Math.max(...completeChapters);
        const totalProcessed = allChapterIdxsProcessed.size;
        let suffix = '';
        if (
          totalProcessed >= maxChapter * 0.9 &&
          totalProcessed < maxChapter &&
          !narratedMilestones.has('almost-done')
        ) {
          narratedMilestones.add('almost-done');
          suffix = ' Almost done.';
        } else if (
          totalProcessed >= maxChapter * 0.5 &&
          !narratedMilestones.has('halfway')
        ) {
          narratedMilestones.add('halfway');
          suffix = ' Halfway there!';
        } else if (
          totalProcessed >= maxChapter * 0.25 &&
          !narratedMilestones.has('quarter')
        ) {
          narratedMilestones.add('quarter');
          const dominantSetting = getDominantSetting(sceneMap);
          suffix = dominantSetting
            ? ` Spending a lot of time in ${dominantSetting}.`
            : '';
        }
        const text = `Through chapter ${maxCompleted}.${suffix}`;
        if (progressLine) {
          await progressLine.update(text);
        } else {
          progressLine = await ctx.narrate(text);
        }
      }

      reportStepProgress(ctx, {
        stepId: 'preliminary_scenes',
        stepStartMs,
        fractionOfStepComplete: allChapterIdxsProcessed.size / maxChapter,
        bookTokens
      });
    } else {
      stalledRounds++;
      ctx.log.warn(
        `No new chapters completed (stalled ${stalledRounds}/${MAX_STALLED_ROUNDS})`
      );
    }

    ctx.log.info(
      `Total chapters processed for scenes: ${Array.from(allChapterIdxsProcessed)
        .sort((a, b) => a - b)
        .join(', ')}`
    );

    if (allChapterIdxsProcessed.size >= maxChapter) {
      ctx.log.info('All chapters accounted for in scene extraction!');
      break;
    }

    if (roundCap !== undefined && round >= roundCap) {
      ctx.log.info(
        `Round cap of ${roundCap} reached; stopping scene extraction after this round.`
      );
      break;
    }
  }

  if (stalledRounds >= MAX_STALLED_ROUNDS) {
    throw new UnrecoverableError(
      `Scene extraction stalled: no progress for ${MAX_STALLED_ROUNDS} consecutive rounds. ` +
        `Completed ${allChapterIdxsProcessed.size}/${maxChapter} chapters.`
    );
  }

  // Convert sceneMap to output format with paragraph indices
  const scenes = Array.from(sceneMap.values()).flatMap((scene) => {
    const thematicBreakGroup = allThematicBreakGroups.find(
      (g) => g.friendlyId === scene.friendlyId
    );

    if (!thematicBreakGroup) {
      ctx.log.warn(`Scene ${scene.friendlyId} not found in thematic break groups`);
      return [];
    }

    return {
      ...scene,
      startBookParagraphIdx: thematicBreakGroup.startBookParagraphIdx,
      endBookParagraphIdx: thematicBreakGroup.endBookParagraphIdx
    };
  });

  return {
    scenes,
    preExistingFriendlyIds,
    allChaptersProcessed: allChapterIdxsProcessed.size >= maxChapter
  };
}

function stripParenthetical(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, '').trim();
}

const RECENT_SCENE_DETAIL_COUNT = 2;

function summarizeExistingScenes(sceneMap: Map<number, SceneDetails>): string {
  const sorted = Array.from(sceneMap.values()).sort(
    (a, b) => a.friendlyId - b.friendlyId
  );

  type Run = {
    povCharacter: string;
    pov: SceneDetails['pov'];
    startChapter: number;
    endChapter: number;
    startScene: number;
    endScene: number;
    sceneCount: number;
  };

  const runs: Run[] = [];
  for (const scene of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.povCharacter === scene.povCharacter && last.pov === scene.pov) {
      last.endChapter = Math.max(last.endChapter, scene.chapterIdx);
      last.endScene = Math.max(last.endScene, scene.friendlyId);
      last.sceneCount++;
    } else {
      runs.push({
        povCharacter: scene.povCharacter,
        pov: scene.pov,
        startChapter: scene.chapterIdx,
        endChapter: scene.chapterIdx,
        startScene: scene.friendlyId,
        endScene: scene.friendlyId,
        sceneCount: 1
      });
    }
  }

  const runLines = runs.map((r) => {
    const chapterRange =
      r.startChapter === r.endChapter
        ? `Chapter ${r.startChapter}`
        : `Chapters ${r.startChapter}-${r.endChapter}`;
    const sceneRange =
      r.startScene === r.endScene
        ? `scene ${r.startScene}`
        : `scenes ${r.startScene}-${r.endScene}`;
    return `- ${chapterRange}: ${r.pov}, ${r.povCharacter} (${sceneRange})`;
  });

  const recent = sorted.slice(-RECENT_SCENE_DETAIL_COUNT);
  const recentLines = recent.map((s) => {
    const parts = [`pov: ${s.pov}`, `narrator: ${s.povCharacter}`, `title: "${s.title}"`];
    if (s.location) parts.push(`location: ${s.location}`);
    if (s.setting) parts.push(`setting: ${s.setting}`);
    return `- Scene ${s.friendlyId} (ch. ${s.chapterIdx}): ${parts.join('; ')}`;
  });

  return dedent`
    POVs so far:
    ${runLines.join('\n')}

    Most recent ${recent.length === 1 ? 'scene' : `${recent.length} scenes`} in full detail (for location/setting and naming continuity):
    ${recentLines.join('\n')}
  `;
}

function getDominantSetting(sceneMap: Map<number, SceneDetails>): string | null {
  const scenes = Array.from(sceneMap.values());
  if (scenes.length === 0) return null;

  const partCounts = new Map<string, number>();
  for (const scene of scenes) {
    if (!scene.setting) continue;
    const seen = new Set<string>();
    for (const raw of scene.setting.split(',')) {
      const part = raw.trim();
      if (part && !seen.has(part)) {
        partCounts.set(part, (partCounts.get(part) ?? 0) + 1);
        seen.add(part);
      }
    }
  }

  if (partCounts.size <= 1) return null;

  let topPart = '';
  let topCount = 0;
  for (const [part, count] of partCounts) {
    if (count > topCount) {
      topCount = count;
      topPart = part;
    }
  }

  return topCount / scenes.length > 0.5 ? topPart : null;
}

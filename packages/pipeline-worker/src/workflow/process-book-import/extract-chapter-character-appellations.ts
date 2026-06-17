import { Agent } from '@earendil-works/pi-agent-core';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

export const APPELLATION_SESSION_NAMESPACE = '5c0e8b3a-1b9c-4d2e-9f8a-7c6b5e4d3a2f';

import {
  getAttribute,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { watchAgent, watchLoopDetection } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getBookEntitiesByBookIdAndTypes } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { createChapterEntityAppellations } from '@/lib/db/models/chapter-entity-appellation/create-chapter-entity-appellation';
import { getNonEmptyChapterParagraphsByChapterIds } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterSceneGroupById } from '@/lib/db/models/chapter-scene-group/get-chapter-scene-group';
import { getChapterScenesWithSettingAndLocationByIds } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { fuzzyMatchByKey } from '@/lib/lit/fuzzy-match';
import { entityNamesFormatted } from '@/lib/lit/names';
import { organizeParagraphsIntoScenes } from '@/lib/lit/organize-paragraphs-into-scenes';
import { buildSceneAttrs } from '@/lib/lit/scene-attrs';
import extractCharacterAppellationsFromChapter from '@/lib/prompts/import/extract-character-appellations-from-chapter';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

export const handler = createWorkflowFunction<
  {
    sceneGroupId: string;
    bookImportId: string;
  },
  {
    sceneGroup: NonNullable<Awaited<ReturnType<typeof getChapterSceneGroupById>>>;
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  }
>(
  {
    name: ({ sceneGroup }, retryCount) =>
      `Character Appellations Group ${sceneGroup.idx}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ sceneGroupId, bookImportId }) => {
      const sceneGroup = await getChapterSceneGroupById(sceneGroupId);
      const bookImport = await getBookImportById(bookImportId);
      if (!sceneGroup || !bookImport)
        throw new UnrecoverableError('Scene Group or Book Import not found');
      const book = await getBookById(sceneGroup.bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { sceneGroup, book, bookImport };
    },
    onFailure: async (_, error) => {
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ sceneGroup }, ctx) => {
    ctx.log
      .withMetadata({
        sceneGroupId: sceneGroup.id,
        sceneGroupIdx: sceneGroup.idx
      })
      .info(`Starting character appellation extraction`);

    const entities = await getBookEntitiesByBookIdAndTypes(sceneGroup.bookId, [
      'CHARACTER',
      'MENTIONED_INDIVIDUAL'
    ]);

    const scenes = await getChapterScenesWithSettingAndLocationByIds(
      sceneGroup.chapterSceneIds
    );

    const chapterIds = [...new Set(scenes.map((s) => s.chapterId))];
    const paragraphs = await getNonEmptyChapterParagraphsByChapterIds(chapterIds);

    const scenesWithParagraphs = organizeParagraphsIntoScenes(scenes, paragraphs);

    const appellations = await extractChapterCharacterAppellations(
      {
        entities,
        scenes: scenesWithParagraphs.map((scene) => ({
          pov: scene.pov,
          povEntity: scene.povEntity,
          paragraphs: scene.paragraphs,
          location: scene.location,
          setting: scene.setting
        })),
        sessionId: uuidv5(sceneGroup.id, APPELLATION_SESSION_NAMESPACE)
      },
      ctx
    );

    const toInsert = appellations.map((appellation) => {
      const sourceEntity = entities.find(
        (e) => e.friendlyId === appellation.sourceCharacterId
      );
      const targetEntity = entities.find(
        (e) => e.friendlyId === appellation.targetCharacterId
      );

      if (!sourceEntity) {
        throw new RecoverableError(
          `Source entity not found for appellation with ID: ${appellation.sourceCharacterId}`
        );
      }
      if (!targetEntity) {
        throw new RecoverableError(
          `Target entity not found for appellation with ID: ${appellation.targetCharacterId}`
        );
      }

      return {
        id: uuidv7(),
        bookId: sceneGroup.bookId,
        chapterId: sceneGroup.startChapterId,
        sourceBookEntityId: sourceEntity.id,
        targetBookEntityId: targetEntity.id,
        phrase: appellation.appellation.phrase,
        type: appellation.appellation.type,
        context: appellation.appellation.context
      };
    });

    const CHUNK_SIZE = 1000;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      await createChapterEntityAppellations(toInsert.slice(i, i + CHUNK_SIZE));
    }

    return Response.json({
      sceneGroupId: sceneGroup.id,
      appellationsCount: appellations.length
    });
  }
);

const CharacterAppellationOutputSchema = v.object({
  appellations: v.array(
    v.object({
      sourceCharacterId: v.string(),
      appellation: v.object({
        phrase: v.string(),
        type: v.string(),
        context: v.string()
      }),
      targetCharacterId: v.string()
    })
  )
});

async function extractChapterCharacterAppellations(
  {
    entities,
    scenes,
    sessionId
  }: {
    entities: {
      friendlyId: string;
      name: string;
      names: string[];
      type: string;
      aliases: string[];
      pronouns?: string | null;
      description?: string | null;
    }[];
    scenes: Array<{
      pov: string;
      povEntity: string;
      paragraphs: { content: string }[];
      location: string | null;
      setting: string | null;
    }>;
    sessionId: string;
  },
  ctx: WorkflowContext
) {
  const mappedScenes = scenes.map((scene) => ({
    attrs: buildSceneAttrs(scene),
    paragraphs: scene.paragraphs.map(({ content }) => content)
  }));

  const userText = extractCharacterAppellationsFromChapter.render({
    entities: entities.map((entity) => ({
      friendlyId: entity.friendlyId,
      name: entityNamesFormatted(entity),
      description: entity.description || undefined
    })),
    scenes: mappedScenes
  });

  const validIds = new Set(entities.map((e) => e.friendlyId));

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId,
    initialState: { model, thinkingLevel: reasoning, tools: [] },
    getApiKey: () => apiKey
  });
  const aw = watchAgent(
    'extractChapterCharacterAppellations',
    agent,
    ctx,
    'appellations'
  );
  const lw = watchLoopDetection(agent, { itemTag: 'appellation' });

  const MAX_CORRECTION_ROUNDS = 2;

  type Appellation = {
    sourceCharacterId: string;
    appellation: { phrase: string; type: string; context: string };
    targetCharacterId: string;
  };
  const accumulatedValid: Appellation[] = [];

  let nextPrompt = userText;
  for (let round = 0; round <= MAX_CORRECTION_ROUNDS; round++) {
    aw.xml = null;
    try {
      await agent.prompt(nextPrompt);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) throw e;
    }

    if (lw.loopDetected) {
      throw new RecoverableError(
        `Loop detected in <${lw.loopDetected.itemTag}> (${lw.loopDetected.count}x): ${lw.loopDetected.sampleBlock}`
      );
    }

    if (agent.state.errorMessage) {
      throw new RecoverableError(`Agent error: ${agent.state.errorMessage}`);
    }

    const xml = aw.xml;
    if (!xml) {
      throw new RecoverableError('No <appellations> found in response');
    }

    const ast = parse(xml);
    const appellationNodes = querySelectorAll(ast, 'appellation');

    const data = {
      appellations: appellationNodes.map((node) => ({
        sourceCharacterId: getAttribute(node, 'source') || '',
        appellation: {
          phrase: getText(querySelector(node, 'phrase')).trim(),
          type: getText(querySelector(node, 'type')).trim(),
          context: getText(querySelector(node, 'context')).trim()
        },
        targetCharacterId: getAttribute(node, 'target') || ''
      }))
    };

    const validated = v.safeParse(CharacterAppellationOutputSchema, data);
    if (!validated.success) {
      ctx.log.error(`Validation error: ${v.summarize(validated.issues)}`);
      throw new RecoverableError(
        `Failed to parse character appellations: ${v.summarize(validated.issues)}`
      );
    }

    const newlyValid = validated.output.appellations.filter(
      (a) => validIds.has(a.sourceCharacterId) && validIds.has(a.targetCharacterId)
    );
    const newlyInvalid = validated.output.appellations.filter(
      (a) => !validIds.has(a.sourceCharacterId) || !validIds.has(a.targetCharacterId)
    );
    accumulatedValid.push(...newlyValid);

    if (newlyInvalid.length === 0) {
      return accumulatedValid;
    }

    if (round === MAX_CORRECTION_ROUNDS) {
      throw new RecoverableError(
        `Could not resolve invalid appellation ids after ${MAX_CORRECTION_ROUNDS + 1} attempts: ${newlyInvalid.map((a) => `${a.sourceCharacterId}->${a.targetCharacterId}`).join(', ')}`
      );
    }

    const badIds = new Set<string>();
    for (const a of newlyInvalid) {
      if (!validIds.has(a.sourceCharacterId)) badIds.add(a.sourceCharacterId);
      if (!validIds.has(a.targetCharacterId)) badIds.add(a.targetCharacterId);
    }

    const correctionLines = Array.from(badIds).map((badId) => {
      const suggestions = fuzzyMatchByKey(entities, badId, (e) => e.friendlyId, 5);
      return suggestions.length > 0
        ? `- "${badId}" — closest matches: ${suggestions.map((s) => `"${s.friendlyId}"`).join(', ')}`
        : `- "${badId}" — no close matches found`;
    });

    const affectedPairs = newlyInvalid
      .map((a) => `${a.sourceCharacterId} -> ${a.targetCharacterId}`)
      .join(', ');

    const correctionText = [
      `The following character ids in your <appellations> response are not in the provided character list:`,
      ...correctionLines,
      '',
      `These ids appear in appellation(s): ${affectedPairs}.`,
      '',
      `Reply with a single <appellations> block containing ONLY corrected <appellation> entries for the affected appellations above — do NOT repeat your previously valid appellations (we have already kept those).`,
      `For each affected appellation: if the suggested ids represent what you meant for source and/or target, re-emit that <appellation> using the corrected id(s). If no suggestion matches one of the endpoints, omit that <appellation> entirely (drop it).`,
      `If every affected appellation should be dropped, reply with an empty block: <appellations></appellations>.`
    ].join('\n');

    ctx.log.info(`Requesting id correction for: ${Array.from(badIds).join(', ')}`);

    nextPrompt = correctionText;
  }

  throw new RecoverableError('Correction loop exited unexpectedly');
}

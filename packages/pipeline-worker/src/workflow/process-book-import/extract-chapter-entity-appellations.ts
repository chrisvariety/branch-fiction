import { Agent } from '@earendil-works/pi-agent-core';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import {
  getBookEntitiesByBookIdAndSignificanceTiers,
  getBookEntitiesByBookIdAndTypes
} from '@/lib/db/models/book-entity/get-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { createChapterEntityAppellations } from '@/lib/db/models/chapter-entity-appellation/create-chapter-entity-appellation';
import { getNonEmptyChapterParagraphsByChapterIds } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterSceneGroupById } from '@/lib/db/models/chapter-scene-group/get-chapter-scene-group';
import { getChapterScenesWithSettingAndLocationByIds } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import { fuzzyMatchByKey } from '@/lib/lit/fuzzy-match';
import { gatherMentions } from '@/lib/lit/gather-mentions';
import { entityNamesFormatted } from '@/lib/lit/names';
import { organizeParagraphsIntoScenes } from '@/lib/lit/organize-paragraphs-into-scenes';
import { buildSceneAttrs } from '@/lib/lit/scene-attrs';
import { watchAgent, watchLoopDetection } from '@/lib/llm/agent';
import {
  getAttribute,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@/lib/llm/xml';
import extractEntityAppellationsFromChapter from '@/lib/prompts/import/extract-entity-appellations-from-chapter';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';
import { APPELLATION_SESSION_NAMESPACE } from '@/workflow/process-book-import/extract-chapter-character-appellations';

// potential improvement: convert XML output to add_appellation (both this + character appellations), keep the Promise.all shape here though (e.g. two extractions), get fuzzy-suggestion + pool-mismatch errors per call
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
      `Entity Appellations Group ${sceneGroup.idx}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
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
      .info(`Starting entity appellation extraction`);

    const significantEntities = (
      await getBookEntitiesByBookIdAndSignificanceTiers(sceneGroup.bookId, [
        'PRIMARY',
        'SECONDARY'
      ])
    ).filter(
      (entity) =>
        // character appellations happen in extract-chapter-character-appellations
        entity.type !== 'CHARACTER' &&
        entity.type !== 'MENTIONED_INDIVIDUAL' &&
        // objects and magic systems get their own focused run
        entity.type !== 'OBJECT' &&
        entity.type !== 'MAGIC_SYSTEM'
    );

    // Run 2: All objects and magic systems (regardless of tier)
    const objectsAndMagicSystems = await getBookEntitiesByBookIdAndTypes(
      sceneGroup.bookId,
      ['MAGIC_SYSTEM', 'OBJECT']
    );

    if (!significantEntities.length && !objectsAndMagicSystems.length) {
      ctx.log.info(`No entities found for scene group ${sceneGroup.id}`);
      return Response.json({
        sceneGroupId: sceneGroup.id,
        appellationsCount: 0
      });
    }

    const allCharacters = await getBookEntitiesByBookIdAndTypes(sceneGroup.bookId, [
      'CHARACTER'
    ]);

    const scenes = await getChapterScenesWithSettingAndLocationByIds(
      sceneGroup.chapterSceneIds
    );

    const chapterIds = [...new Set(scenes.map((s) => s.chapterId))];
    const paragraphs = await getNonEmptyChapterParagraphsByChapterIds(chapterIds);

    const scenesWithParagraphs = organizeParagraphsIntoScenes(scenes, paragraphs);

    const mentionedCharacters = gatherMentions(
      paragraphs.map((paragraph) => paragraph.content).join('\n'),
      allCharacters,
      Array.from(new Set(scenes.flatMap((scene) => scene.povBookEntityId || [])))
    );

    const mentionedCharactersArray = Array.from(mentionedCharacters);

    if (mentionedCharactersArray.length === 0) {
      ctx.log.info(`No characters mentioned in scene group ${sceneGroup.id}`);
      return Response.json({
        sceneGroupId: sceneGroup.id,
        appellationsCount: 0
      });
    }

    const sessionId = uuidv5(sceneGroup.id, APPELLATION_SESSION_NAMESPACE);

    const runExtraction = async (
      entities: typeof significantEntities,
      runLabel: string
    ): Promise<Awaited<ReturnType<typeof extractChapterEntityAppellations>>> => {
      if (!entities.length) {
        ctx.log.info(`No ${runLabel} entities to process`);
        return [];
      }
      ctx.log.info(`${runLabel}: starting extraction`);
      return extractChapterEntityAppellations(
        {
          entities,
          characters: mentionedCharactersArray,
          scenes: scenesWithParagraphs.map((scene) => ({
            pov: scene.pov,
            povEntity: scene.povEntity,
            paragraphs: scene.paragraphs,
            location: scene.location,
            setting: scene.setting
          })),
          sessionId
        },
        ctx
      );
    };

    const [significantAppellations, objectMagicAppellations] = await Promise.all([
      runExtraction(significantEntities, 'Significant entities'),
      runExtraction(objectsAndMagicSystems, 'Objects & Magic Systems')
    ]);

    const validAppellations = [...significantAppellations, ...objectMagicAppellations];
    const allEntities = [...significantEntities, ...objectsAndMagicSystems];

    const toInsert = validAppellations.map((appellation) => {
      const sourceEntity = mentionedCharactersArray.find(
        (c) => c.friendlyId === appellation.sourceCharacterId
      )!;
      const targetEntity = allEntities.find(
        (e) => e.friendlyId === appellation.targetEntityId
      )!;

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
      appellationsCount: validAppellations.length
    });
  }
);

const AppellationOutputSchema = v.object({
  appellations: v.array(
    v.object({
      sourceCharacterId: v.pipe(
        v.string(),
        v.transform((value) => value.replace('char_', ''))
      ),
      appellation: v.object({
        phrase: v.string(),
        type: v.string(),
        context: v.string()
      }),
      targetEntityId: v.pipe(
        v.string(),
        v.transform((value) => value.replace('ent_', ''))
      )
    })
  )
});

async function extractChapterEntityAppellations(
  {
    entities,
    characters,
    scenes,
    sessionId
  }: {
    entities: {
      friendlyId: string;
      name: string;
      names: string[];
      type: string;
      aliases: string[];
      description?: string | null;
      pronouns?: string | null;
    }[];
    characters: {
      friendlyId: string;
      name: string;
      names: string[];
      type: string;
      aliases: string[];
      description?: string | null;
      pronouns?: string | null;
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

  const userText = extractEntityAppellationsFromChapter.render({
    characters: characters.map((entity) => ({
      friendlyId: entity.friendlyId,
      name: entityNamesFormatted(entity),
      description: entity.description || undefined
    })),
    entities: entities.map((entity) => ({
      friendlyId: entity.friendlyId,
      name: entityNamesFormatted(entity),
      description: entity.description || undefined
    })),
    scenes: mappedScenes
  });

  const characterIds = new Set(characters.map((c) => c.friendlyId));
  const entityIds = new Set(entities.map((e) => e.friendlyId));

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId,
    initialState: { model, thinkingLevel: reasoning, tools: [] },
    getApiKey: () => apiKey
  });
  const aw = watchAgent('extractChapterEntityAppellations', agent, ctx, 'appellations');
  const lw = watchLoopDetection(agent, { itemTag: 'appellation' });

  const MAX_CORRECTION_ROUNDS = 2;

  type Appellation = {
    sourceCharacterId: string;
    appellation: { phrase: string; type: string; context: string };
    targetEntityId: string;
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
        targetEntityId: getAttribute(node, 'target') || ''
      }))
    };

    const validated = v.safeParse(AppellationOutputSchema, data);
    if (!validated.success) {
      ctx.log.error(`Validation error: ${v.summarize(validated.issues)}`);
      throw new RecoverableError(
        `Failed to parse entity appellations: ${v.summarize(validated.issues)}`
      );
    }

    // Silently discard type-confused appellations (source ended up in entity pool, or target in character pool).
    // These signal the LLM mis-categorized rather than hallucinated; retrying tends not to help.
    const notTypeConfused = validated.output.appellations.filter((a) => {
      const sourceWrongPool =
        !characterIds.has(a.sourceCharacterId) && entityIds.has(a.sourceCharacterId);
      const targetWrongPool =
        !entityIds.has(a.targetEntityId) && characterIds.has(a.targetEntityId);
      if (sourceWrongPool || targetWrongPool) {
        ctx.log.warn(
          `Discarding type-confused appellation: char_${a.sourceCharacterId} -> ent_${a.targetEntityId}`
        );
        return false;
      }
      return true;
    });

    const newlyValid = notTypeConfused.filter(
      (a) => characterIds.has(a.sourceCharacterId) && entityIds.has(a.targetEntityId)
    );
    const newlyInvalid = notTypeConfused.filter(
      (a) => !characterIds.has(a.sourceCharacterId) || !entityIds.has(a.targetEntityId)
    );
    accumulatedValid.push(...newlyValid);

    if (newlyInvalid.length === 0) {
      return accumulatedValid;
    }

    if (round === MAX_CORRECTION_ROUNDS) {
      throw new RecoverableError(
        `Could not resolve invalid appellation ids after ${MAX_CORRECTION_ROUNDS + 1} attempts: ${newlyInvalid.map((a) => `char_${a.sourceCharacterId}->ent_${a.targetEntityId}`).join(', ')}`
      );
    }

    const badSourceIds = new Set<string>();
    const badTargetIds = new Set<string>();
    for (const a of newlyInvalid) {
      if (!characterIds.has(a.sourceCharacterId)) badSourceIds.add(a.sourceCharacterId);
      if (!entityIds.has(a.targetEntityId)) badTargetIds.add(a.targetEntityId);
    }

    const sourceCorrectionLines = Array.from(badSourceIds).map((badId) => {
      const suggestions = fuzzyMatchByKey(characters, badId, (c) => c.friendlyId, 5);
      return suggestions.length > 0
        ? `- "char_${badId}" — closest character matches: ${suggestions.map((s) => `"char_${s.friendlyId}"`).join(', ')}`
        : `- "char_${badId}" — no close character matches found`;
    });

    const targetCorrectionLines = Array.from(badTargetIds).map((badId) => {
      const suggestions = fuzzyMatchByKey(entities, badId, (e) => e.friendlyId, 5);
      return suggestions.length > 0
        ? `- "ent_${badId}" — closest entity matches: ${suggestions.map((s) => `"ent_${s.friendlyId}"`).join(', ')}`
        : `- "ent_${badId}" — no close entity matches found`;
    });

    const affectedPairs = newlyInvalid
      .map((a) => `char_${a.sourceCharacterId} -> ent_${a.targetEntityId}`)
      .join(', ');

    const correctionText = [
      `The following ids in your <appellations> response are not in the provided lists:`,
      ...sourceCorrectionLines,
      ...targetCorrectionLines,
      '',
      `These ids appear in appellation(s): ${affectedPairs}.`,
      '',
      `Reply with a single <appellations> block containing ONLY corrected <appellation> entries for the affected appellations above — do NOT repeat your previously valid appellations (we have already kept those).`,
      `For each affected appellation: if the suggested ids represent what you meant, re-emit that <appellation> using the corrected id(s) (keeping the "char_" / "ent_" prefixes). If no suggestion matches one of the endpoints, omit that <appellation> entirely (drop it).`,
      `If every affected appellation should be dropped, reply with an empty block: <appellations></appellations>.`
    ].join('\n');

    ctx.log.info(
      `Requesting id correction for sources: [${Array.from(badSourceIds).join(', ')}], targets: [${Array.from(badTargetIds).join(', ')}]`
    );

    nextPrompt = correctionText;
  }

  throw new RecoverableError('Correction loop exited unexpectedly');
}

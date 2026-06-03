import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { encode } from '@toon-format/toon';
import { v7 as uuidv7 } from 'uuid';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getDb } from '@/lib/db';
import { getBookEntitiesByBookIdAndTypes } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getChapterScenesByBookId } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { updateChapterSceneById } from '@/lib/db/models/chapter-scene/update-chapter-scene';
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import { watchAgent } from '@/lib/llm/agent';
import finalizeScenePrompt from '@/lib/prompts/import/finalize-scenes';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

const BATCH_SIZE = 100;
const MAX_GLOBAL_ATTEMPTS = 15;

export const handler = createWorkflowFunction<
  {
    bookImportId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  },
  { bookId: string; sceneCount: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Finalize Scenes ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookImportId }) => {
      const bookImport = await getBookImportById(bookImportId);
      if (!bookImport) throw new UnrecoverableError('Book Import not found');
      if (!bookImport.bookId) throw new UnrecoverableError('Book ID not found');
      const book = await getBookById(bookImport.bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      return { book, bookImport };
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
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting scene finalization');

    await ctx.narrate('Remember all those scenes? Time to tie all that data together.');

    const bookEntities = await getBookEntitiesByBookIdAndTypes(book.id, [
      'CHARACTER',
      'PLACE'
    ]);

    const scenes = await getChapterScenesByBookId(book.id);
    if (scenes.length === 0)
      throw new UnrecoverableError(`No scenes found for book id: ${book.id}`);

    const { finalizedScenes } = await finalizeScenes(
      {
        scenes,
        characters: bookEntities.filter((entity) => entity.type === 'CHARACTER'),
        places: bookEntities.filter((entity) => entity.type === 'PLACE')
      },
      ctx
    );

    await getDb()
      .transaction()
      .execute(async (trx) => {
        for (const scene of finalizedScenes) {
          await updateChapterSceneById(scene.id, { ...scene, isPreliminary: false }, trx);
        }
      });

    return {
      bookId: book.id,
      sceneCount: scenes.length
    };
  }
);

const FinalizeSceneSchema = Type.Object({
  scene_id: Type.String({ description: 'The scene identifier from input' }),
  pov_character_id: Type.Union([Type.String(), Type.Null()], {
    description: 'The matched character ID for POV, or null if no match'
  }),
  setting_id: Type.Union([Type.String(), Type.Null()], {
    description: 'The matched location ID for the broader setting, or null if no match'
  }),
  location_id: Type.Union([Type.String(), Type.Null()], {
    description: 'The matched location ID for the immediate location, or null if no match'
  })
});

async function finalizeScenes(
  {
    scenes,
    characters,
    places
  }: {
    scenes: Awaited<ReturnType<typeof getChapterScenesByBookId>>;
    characters: Array<{
      id: string;
      friendlyId: string;
      name: string;
      names: string[] | null;
      description?: string | null;
    }>;
    places: Array<{
      id: string;
      friendlyId: string;
      name: string;
      names: string[] | null;
      description?: string | null;
    }>;
  },
  ctx: WorkflowContext
) {
  ctx.log.info('Starting scene finalization...');

  const scenesToProcess = scenes.filter((scene) => {
    const hasLocation = scene.location !== null && scene.location !== '';
    const hasSetting = scene.setting !== null && scene.setting !== '';
    const hasPovEntity =
      scene.povEntity !== null &&
      scene.povEntity !== '' &&
      scene.povEntity !== 'Omniscient Narrator';

    const shouldProcess = hasLocation || hasSetting || hasPovEntity;

    if (!shouldProcess) {
      ctx.log.info(`Skipping scene ${scene.id}: no location, setting, or named POV`);
    }

    return shouldProcess;
  });

  ctx.log.info(
    `Processing ${scenesToProcess.length} of ${scenes.length} scenes (${scenes.length - scenesToProcess.length} skipped)`
  );

  // If no scenes need processing, return early
  if (scenesToProcess.length === 0) {
    ctx.log.info('No scenes require finalization');
    return {
      finalizedScenes: scenes.map((scene) => ({
        id: scene.id,
        povBookEntityId: scene.povBookEntityId,
        settingBookEntityId: scene.settingBookEntityId,
        locationBookEntityId: scene.locationBookEntityId
      }))
    };
  }

  // Create stable friendly ID mappings for the LLM (scene_1, scene_2, etc.)
  const sceneFriendlyIdToRealId = new Map<string, string>();
  const sceneRealIdToFriendlyId = new Map<string, string>();
  scenesToProcess.forEach((scene, index) => {
    const friendlyId = `scene_${index + 1}`;
    sceneFriendlyIdToRealId.set(friendlyId, scene.id);
    sceneRealIdToFriendlyId.set(scene.id, friendlyId);
  });

  // Create mappings for characters and locations (friendlyId -> realId)
  const characterFriendlyIdToRealId = new Map<string, string>();
  characters.forEach((character) => {
    characterFriendlyIdToRealId.set(character.friendlyId, character.id);
  });

  const locationFriendlyIdToRealId = new Map<string, string>();
  places.forEach((place) => {
    locationFriendlyIdToRealId.set(place.friendlyId, place.id);
  });

  // Encode characters and locations once (shared across all batches)
  const charactersEncoded = encode({
    characters: characters.map((c) => ({
      id: c.friendlyId,
      name: c.name,
      names: c.names,
      description: c.description
    }))
  });

  const locationsEncoded = encode({
    locations: places.map((p) => ({
      id: p.friendlyId,
      name: p.name,
      names: p.names,
      description: p.description
    }))
  });

  // Split scenes into initial batches
  const initialBatches: (typeof scenesToProcess)[] = [];
  for (let i = 0; i < scenesToProcess.length; i += BATCH_SIZE) {
    initialBatches.push(scenesToProcess.slice(i, i + BATCH_SIZE));
  }

  ctx.log.info(
    `Split ${scenesToProcess.length} scenes into ${initialBatches.length} initial batches`
  );

  // Track all finalized scenes and carry forward missed ones
  const allSceneUpdates = new Map<
    string,
    {
      povBookEntityId: string | null;
      settingBookEntityId: string | null;
      locationBookEntityId: string | null;
    }
  >();

  let globalAttempt = 0;
  let carryForwardScenes: typeof scenesToProcess = [];
  let progressLine: Awaited<ReturnType<typeof ctx.narrate>> | null = null;

  const sessionId = uuidv7();

  // Process initial batches, carrying forward any missed scenes
  for (let batchIndex = 0; batchIndex < initialBatches.length; batchIndex++) {
    // Combine initial batch with any carried forward scenes from previous batches
    const currentBatch = [...initialBatches[batchIndex], ...carryForwardScenes];
    carryForwardScenes = [];

    globalAttempt++;
    if (globalAttempt > MAX_GLOBAL_ATTEMPTS) {
      break;
    }

    ctx.log.info(
      `Processing batch ${batchIndex + 1}/${initialBatches.length} (${currentBatch.length} scenes, attempt ${globalAttempt}/${MAX_GLOBAL_ATTEMPTS})`
    );

    const { finalized, missed } = await processBatch(
      {
        batch: currentBatch,
        sceneRealIdToFriendlyId,
        sceneFriendlyIdToRealId,
        characterFriendlyIdToRealId,
        locationFriendlyIdToRealId,
        charactersEncoded,
        locationsEncoded,
        sessionId
      },
      ctx
    );

    // Merge finalized scenes
    for (const [sceneId, update] of finalized.entries()) {
      allSceneUpdates.set(sceneId, update);
    }

    // Carry forward missed scenes to next batch
    carryForwardScenes = missed;

    if (initialBatches.length > 1) {
      const text = `Group ${batchIndex + 1} of ${initialBatches.length} done.`;
      if (progressLine) {
        await progressLine.update(text);
      } else {
        progressLine = await ctx.narrate(text);
      }
    }

    ctx.log.info(
      `Batch ${batchIndex + 1} complete. Finalized: ${finalized.size}, Carried forward: ${missed.length}. Total: ${allSceneUpdates.size}/${scenesToProcess.length}`
    );
  }

  // If we still have scenes to process after all initial batches, keep retrying
  while (carryForwardScenes.length > 0 && globalAttempt < MAX_GLOBAL_ATTEMPTS) {
    globalAttempt++;

    // Split remaining scenes into batches if there are many
    const remainingBatches: (typeof scenesToProcess)[] = [];
    for (let i = 0; i < carryForwardScenes.length; i += BATCH_SIZE) {
      remainingBatches.push(carryForwardScenes.slice(i, i + BATCH_SIZE));
    }

    ctx.log.info(
      `Retry round ${globalAttempt}/${MAX_GLOBAL_ATTEMPTS}: ${carryForwardScenes.length} scenes remaining in ${remainingBatches.length} batch(es)`
    );

    carryForwardScenes = [];

    for (const batch of remainingBatches) {
      if (globalAttempt > MAX_GLOBAL_ATTEMPTS) {
        carryForwardScenes.push(...batch);
        continue;
      }

      const { finalized, missed } = await processBatch(
        {
          batch,
          sceneRealIdToFriendlyId,
          sceneFriendlyIdToRealId,
          characterFriendlyIdToRealId,
          locationFriendlyIdToRealId,
          charactersEncoded,
          locationsEncoded,
          sessionId
        },
        ctx
      );

      for (const [sceneId, update] of finalized.entries()) {
        allSceneUpdates.set(sceneId, update);
      }

      carryForwardScenes.push(...missed);
    }

    if (carryForwardScenes.length > 0) {
      ctx.log.warn(
        `After attempt ${globalAttempt}: ${carryForwardScenes.length} scenes still unfinalized`
      );
    }
  }

  // Final check
  if (carryForwardScenes.length > 0) {
    const missingIds = carryForwardScenes.map((s) => sceneRealIdToFriendlyId.get(s.id));
    throw new RecoverableError(
      `Failed to finalize ${carryForwardScenes.length} scenes after ${globalAttempt} attempts: ${missingIds.slice(0, 10).join(', ')}${missingIds.length > 10 ? '...' : ''}`
    );
  }

  ctx.log.info(
    `Finalization complete after ${globalAttempt} attempt(s). Successfully finalized ${allSceneUpdates.size} scenes`
  );

  return {
    finalizedScenes: scenesToProcess.map((scene) => {
      const update = allSceneUpdates.get(scene.id)!;
      return {
        id: scene.id,
        povBookEntityId: update.povBookEntityId,
        settingBookEntityId: update.settingBookEntityId,
        locationBookEntityId: update.locationBookEntityId
      };
    })
  };
}

async function processBatch(
  {
    batch,
    sceneRealIdToFriendlyId,
    sceneFriendlyIdToRealId,
    characterFriendlyIdToRealId,
    locationFriendlyIdToRealId,
    charactersEncoded,
    locationsEncoded,
    sessionId
  }: {
    batch: Awaited<ReturnType<typeof getChapterScenesByBookId>>;
    sceneRealIdToFriendlyId: Map<string, string>;
    sceneFriendlyIdToRealId: Map<string, string>;
    characterFriendlyIdToRealId: Map<string, string>;
    locationFriendlyIdToRealId: Map<string, string>;
    charactersEncoded: string;
    locationsEncoded: string;
    sessionId: string;
  },
  ctx: WorkflowContext
): Promise<{
  finalized: Map<
    string,
    {
      povBookEntityId: string | null;
      settingBookEntityId: string | null;
      locationBookEntityId: string | null;
    }
  >;
  missed: Awaited<ReturnType<typeof getChapterScenesByBookId>>;
}> {
  const finalized = new Map<
    string,
    {
      povBookEntityId: string | null;
      settingBookEntityId: string | null;
      locationBookEntityId: string | null;
    }
  >();

  const batchSceneIds = new Set(batch.map((s) => sceneRealIdToFriendlyId.get(s.id)));

  const finalizeSceneTool: AgentTool<typeof FinalizeSceneSchema> = {
    name: 'finalize_scene',
    label: 'Finalize Scene',
    description: 'Set the finalized entity matches for a scene. Call once per scene.',
    parameters: FinalizeSceneSchema,
    execute: async (_id, args) => {
      if (!batchSceneIds.has(args.scene_id)) {
        const errorMsg = `Scene ID ${args.scene_id} is not in this batch.`;
        ctx.log.warn(errorMsg);
        throw new Error(errorMsg);
      }

      const realSceneId = sceneFriendlyIdToRealId.get(args.scene_id);
      if (!realSceneId) {
        const errorMsg = `Unknown scene ID: ${args.scene_id}`;
        ctx.log.warn(errorMsg);
        throw new Error(errorMsg);
      }

      const realCharacterId = args.pov_character_id
        ? (characterFriendlyIdToRealId.get(args.pov_character_id) ?? null)
        : null;

      const realSettingId = args.setting_id
        ? (locationFriendlyIdToRealId.get(args.setting_id) ?? null)
        : null;

      const realLocationId = args.location_id
        ? (locationFriendlyIdToRealId.get(args.location_id) ?? null)
        : null;

      finalized.set(realSceneId, {
        povBookEntityId: realCharacterId,
        settingBookEntityId: realSettingId,
        locationBookEntityId: realLocationId
      });

      ctx.log.info(
        `✓ Finalized scene ${args.scene_id}: pov=${args.pov_character_id}, setting=${args.setting_id}, location=${args.location_id}`
      );
      return {
        content: [
          { type: 'text', text: `Successfully finalized scene ${args.scene_id}` }
        ],
        details: {}
      };
    }
  };

  const userText = finalizeScenePrompt.render({
    characters: charactersEncoded,
    locations: locationsEncoded,
    scenes: encode({
      scenes: batch.map((s) => ({
        id: sceneRealIdToFriendlyId.get(s.id),
        pov_entity: s.povEntity,
        setting: s.setting,
        location: s.location,
        title: s.title
      }))
    })
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId,
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [finalizeSceneTool]
    },
    getApiKey: () => apiKey
  });

  watchAgent('finalizeScenes', agent, ctx);

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Scene finalization aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  // Determine which scenes were missed
  const missed = batch.filter((s) => !finalized.has(s.id));

  if (missed.length > 0) {
    const missedIds = missed.map((s) => sceneRealIdToFriendlyId.get(s.id));
    ctx.log.warn(`Batch missed ${missed.length} scenes: ${missedIds.join(', ')}`);
  }

  return { finalized, missed };
}

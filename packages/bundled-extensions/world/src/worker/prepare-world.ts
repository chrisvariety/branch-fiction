import dedent from 'dedent';
import { v7 as uuidv7 } from 'uuid';

import type { WorldModel } from '@/lib/db/types';
import { UnrecoverableError } from '@/lib/error-types';
import { completeOrThrow, getAssistantText } from '@/lib/llm/agent';
import { getText, parse, querySelector } from '@/lib/llm/xml';
import { resolveArtStyle } from '@/lib/media/art-style';
import { generateOneShotImage } from '@/lib/media/generate-one-shot-image';
import { buildAssetUrl, parseAssetUrl } from '@/lib/media/transform-url';
import heliosWorld from '@/lib/prompts/helios-world';
import lingbotWorld from '@/lib/prompts/lingbot-world';
import { ensureDbReady, getDb } from '@/worker/db';
import { getBookArcsByBookIdAndTypesAndEntityIds } from '@/worker/db/models/book-arc/get-book-arc';
import { getBookEntityById } from '@/worker/db/models/book-entity/get-book-entity';
import { createWorkflowFunction, type WorkflowContext } from '@/worker/handler';
import { getProvider } from '@/worker/providers';

export interface PrepareWorldPayload {
  characterId: string;
  placeId: string;
  model: WorldModel;
}

export interface PrepareWorldResult {
  worldId: string;
  model: WorldModel;
  prompt: string;
  seedImageUrl: string;
}

export async function prepareWorld(
  payload: PrepareWorldPayload
): Promise<PrepareWorldResult> {
  await ensureDbReady();
  return runPrepareWorld({ executionId: uuidv7(), payload });
}

// First isolated appearance arc is the self-contained snapshot to drive a standalone scene.
function isolatedAppearance(
  arcs: Array<{ content: string }>,
  fallback: string | null
): string {
  return arcs[0]?.content || fallback || '';
}

const runPrepareWorld = createWorkflowFunction<
  PrepareWorldPayload,
  PrepareWorldPayload,
  PrepareWorldResult
>(
  {
    name: ({ model }) => `Prepare ${model} world`
  },
  async ({ characterId, placeId, model }, ctx): Promise<PrepareWorldResult> => {
    if (host.bookId === null) {
      throw new UnrecoverableError('prepareWorld requires a bookId — launch from a book');
    }
    const bookId = host.bookId;

    const character = await getBookEntityById(characterId);
    if (!character || character.type !== 'CHARACTER') {
      throw new UnrecoverableError('Selected character not found');
    }
    const place = await getBookEntityById(placeId);
    if (!place || place.type !== 'PLACE') {
      throw new UnrecoverableError('Selected place not found');
    }

    const [characterArcs, placeArcs] = await Promise.all([
      getBookArcsByBookIdAndTypesAndEntityIds(
        bookId,
        ['APPEARANCE_ISOLATED'],
        [characterId]
      ),
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['APPEARANCE_ISOLATED'], [placeId])
    ]);

    const characterAppearance = isolatedAppearance(characterArcs, character.description);
    const placeAppearance = isolatedAppearance(placeArcs, place.description);

    ctx.log
      .withMetadata({ character: character.name, place: place.name, model })
      .info('Augmenting isolated appearance arcs into world prompt');

    const template = model === 'helios' ? heliosWorld : lingbotWorld;
    const promptText = template.render({
      character: { name: character.name, appearance: characterAppearance },
      place: { name: place.name, appearance: placeAppearance }
    });

    const { model: piModel, apiKey, reasoning } = ctx.getPiModel('text');
    const message = await completeOrThrow(
      piModel,
      { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);

    const text = getAssistantText(message);
    const worldPrompt = getText(querySelector(parse(text), 'world_prompt')).trim();
    if (!worldPrompt) {
      throw new Error('LLM did not return a <world_prompt>');
    }

    const seedImageUrl = await generateSeedImage(
      {
        characterName: character.name,
        characterAppearance,
        placeName: place.name,
        placeAppearance
      },
      ctx
    );

    const worldId = uuidv7();
    await getDb()
      .insertInto('worlds')
      .values({
        id: worldId,
        bookId,
        characterEntityId: characterId,
        placeEntityId: placeId,
        model,
        prompt: worldPrompt,
        seedImageUrl
      })
      .execute();

    ctx.log.withMetadata({ worldId, seedImageUrl }).info('World prepared');

    return { worldId, model, prompt: worldPrompt, seedImageUrl };
  }
);

async function generateSeedImage(
  {
    characterName,
    characterAppearance,
    placeName,
    placeAppearance
  }: {
    characterName: string;
    characterAppearance: string;
    placeName: string;
    placeAppearance: string;
  },
  ctx: WorkflowContext
): Promise<string> {
  const prompt = dedent`
    A cinematic establishing scene: ${characterName} within ${placeName}.

    ${placeName}: ${placeAppearance}

    ${characterName}: ${characterAppearance}

    Requirements:
    - Show ${characterName} present in the environment, framed as a world-entry establishing shot.
    - Rendered in a ${resolveArtStyle(null)}.
    - Do not include any text, labels, or names.`;

  ctx.log.withMetadata({ placeName, characterName }).info('Generating seed image');

  const { data, mimeType } = await generateOneShotImage(
    getProvider('image_generation_seed'),
    {
      prompt,
      aspectRatio: '16:9'
    }
  );

  const key = `world-seed/${uuidv7()}`;
  const imageUrl = buildAssetUrl(key, mimeType);
  await ctx.fs.write(parseAssetUrl(imageUrl).relPath, data);
  return imageUrl;
}

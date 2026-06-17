import { v7 as uuidv7 } from 'uuid';

import type { WorldModel } from '@/lib/db/types';
import { UnrecoverableError } from '@/lib/error-types';
import { convertArcFriendlyIdPrefixToIsolated } from '@/lib/lit/arc-types';
import { completeOrThrow, getAssistantText } from '@/lib/llm/agent';
import { getText, parse, querySelector } from '@/lib/llm/xml';
import { resolveArtStyle } from '@/lib/media/art-style';
import { generateOneShotImage } from '@/lib/media/generate-one-shot-image';
import { buildAssetUrl, parseAssetUrl } from '@/lib/media/transform-url';
import heliosWorld from '@/lib/prompts/helios-world';
import lingbotWorld from '@/lib/prompts/lingbot-world';
import worldSeed from '@/lib/prompts/world-seed';
import { ensureDbReady, getDb } from '@/worker/db';
import { getBookArcsByBookIdAndTypesAndEntityIds } from '@/worker/db/models/book-arc/get-book-arc';
import { getBookEntityById } from '@/worker/db/models/book-entity/get-book-entity';
import { createWorkflowFunction, type WorkflowContext } from '@/worker/handler';
import { getProvider } from '@/worker/providers';

export interface PrepareWorldPayload {
  characterId: string;
  placeId: string;
  model: WorldModel;
  artStyle: string;
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

interface ArcRow {
  friendlyId: string;
  title: string | null;
  startChapterIdx?: number | null;
  endChapterIdx?: number | null;
  content: string;
}

// LLM selects on the cumulative narrative; we render/image from the isolated standalone.
interface CharacterAppearance {
  id: string;
  title: string;
  chapterRange: string;
  narrative: string;
  standalone: string;
}

interface PlaceAppearance {
  id: string;
  title: string;
  chapterRange: string;
  content: string;
}

const chapterRange = (a: ArcRow) =>
  `${a.startChapterIdx ?? '?'}-${a.endChapterIdx ?? '?'}`;

// Pair each cumulative arc to its isolated sibling (A-… → AI-…).
function buildCharacterAppearances(
  cumulativeArcs: ArcRow[],
  isolatedArcs: ArcRow[],
  fallback: string | null
): CharacterAppearance[] {
  const isolatedByFriendlyId = new Map(
    isolatedArcs.map((a) => [a.friendlyId, a.content])
  );

  if (cumulativeArcs.length > 0) {
    return cumulativeArcs.map((a) => {
      const standalone =
        isolatedByFriendlyId.get(convertArcFriendlyIdPrefixToIsolated(a.friendlyId)) ??
        a.content;
      return {
        id: a.friendlyId,
        title: a.title || 'Untitled',
        chapterRange: chapterRange(a),
        narrative: a.content,
        standalone
      };
    });
  }

  // No cumulative arcs: fall back to isolated arcs directly, then the entity description.
  if (isolatedArcs.length > 0) {
    return isolatedArcs.map((a) => ({
      id: a.friendlyId,
      title: a.title || 'Untitled',
      chapterRange: chapterRange(a),
      narrative: a.content,
      standalone: a.content
    }));
  }
  return fallback
    ? [
        {
          id: 'fallback',
          title: 'Description',
          chapterRange: '?-?',
          narrative: fallback,
          standalone: fallback
        }
      ]
    : [];
}

function buildPlaceAppearances(
  isolatedArcs: ArcRow[],
  fallback: string | null
): PlaceAppearance[] {
  if (isolatedArcs.length > 0) {
    return isolatedArcs.map((a) => ({
      id: a.friendlyId,
      title: a.title || 'Untitled',
      chapterRange: chapterRange(a),
      content: a.content
    }));
  }
  return fallback
    ? [{ id: 'fallback', title: 'Description', chapterRange: '?-?', content: fallback }]
    : [];
}

const runPrepareWorld = createWorkflowFunction<
  PrepareWorldPayload,
  PrepareWorldPayload,
  PrepareWorldResult
>(
  {
    name: ({ model }) => `Prepare ${model} world`
  },
  async ({ characterId, placeId, model, artStyle }, ctx): Promise<PrepareWorldResult> => {
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

    const [characterCumulativeArcs, characterIsolatedArcs, placeArcs] = await Promise.all(
      [
        getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['APPEARANCE'], [characterId]),
        getBookArcsByBookIdAndTypesAndEntityIds(
          bookId,
          ['APPEARANCE_ISOLATED'],
          [characterId]
        ),
        getBookArcsByBookIdAndTypesAndEntityIds(
          bookId,
          ['APPEARANCE_ISOLATED'],
          [placeId]
        )
      ]
    );

    const characterAppearances = buildCharacterAppearances(
      characterCumulativeArcs,
      characterIsolatedArcs,
      character.description
    );
    const placeAppearances = buildPlaceAppearances(placeArcs, place.description);
    if (characterAppearances.length === 0) {
      throw new UnrecoverableError(`No appearance data for ${character.name}`);
    }

    ctx.log
      .withMetadata({
        character: character.name,
        place: place.name,
        model,
        characterAppearanceOptions: characterAppearances.length
      })
      .info('Selecting place-appropriate appearance and augmenting into world prompt');

    const template = model === 'helios' ? heliosWorld : lingbotWorld;
    const promptText = template.render({
      character: {
        name: character.name,
        appearances: characterAppearances.map((a) => ({
          id: a.id,
          title: a.title,
          chapterRange: a.chapterRange,
          content: a.narrative
        }))
      },
      place: { name: place.name, appearances: placeAppearances }
    });

    const { model: piModel, apiKey, reasoning } = ctx.getPiModel('text');
    const message = await completeOrThrow(
      piModel,
      { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);

    const text = getAssistantText(message);
    const ast = parse(text);
    const worldPrompt = getText(querySelector(ast, 'world_prompt')).trim();
    if (!worldPrompt) {
      throw new Error('LLM did not return a <world_prompt>');
    }

    // Reuse the LLM's chosen appearance (isolated standalone text) for the seed image.
    const selectedId = getText(querySelector(ast, 'selected_appearance_id')).trim();
    const selectedAppearance =
      characterAppearances.find((a) => a.id === selectedId) ?? characterAppearances[0];

    console.log(
      `[world] ${model} prompt (appearance ${selectedAppearance.id} "${selectedAppearance.title}"):\n${worldPrompt}`
    );
    ctx.log
      .withMetadata({ model, worldPrompt, selectedAppearanceId: selectedAppearance.id })
      .info('World prompt generated');

    const seedImageUrl = await generateSeedImage(
      {
        model,
        artStyle,
        worldPrompt,
        characterName: character.name,
        characterAppearance: selectedAppearance.standalone,
        placeName: place.name,
        placeAppearance: placeAppearances[0]?.content ?? place.description ?? ''
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
    model,
    artStyle,
    worldPrompt,
    characterName,
    characterAppearance,
    placeName,
    placeAppearance
  }: {
    model: WorldModel;
    artStyle: string;
    worldPrompt: string;
    characterName: string;
    characterAppearance: string;
    placeName: string;
    placeAppearance: string;
  },
  ctx: WorkflowContext
): Promise<string> {
  // The seed conditions the world model, so match each model's preferred framing.
  const prompt = worldSeed.render({
    model,
    artStyle: resolveArtStyle(artStyle),
    worldPrompt,
    character: { name: characterName, appearance: characterAppearance },
    place: { name: placeName, appearance: placeAppearance }
  });

  console.log(`[world] seed image prompt:\n${prompt}`);
  ctx.log
    .withMetadata({ placeName, characterName, prompt })
    .info('Generating seed image');

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

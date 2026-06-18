import {
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { resolveArtStyle } from '@branch-fiction/extension-sdk/media/art-style';
import { generateOneShotImage } from '@branch-fiction/extension-sdk/media/generate-one-shot-image';
import {
  buildAssetUrl,
  parseAssetUrl
} from '@branch-fiction/extension-sdk/media/transform-url';
import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';

import characterPersonality from '@/lib/prompts/character-personality';
import characterPortrait from '@/lib/prompts/character-portrait';
import characterScenarios from '@/lib/prompts/character-scenarios';
import { isScenarioMode } from '@/lib/scenarios';
import { buildKnowledge, hashContent } from '@/worker/build-knowledge';
import { ensureDbReady } from '@/worker/db';
import {
  replaceScenarios,
  type ScenarioInput
} from '@/worker/db/models/avatar-scenario/replace-scenarios';
import { upsertAvatar } from '@/worker/db/models/avatar/upsert-avatar';
import { getBookArcsByBookIdAndTypesAndEntityIds } from '@/worker/db/models/book-arc/get-book-arc';
import { getBookEntityById } from '@/worker/db/models/book-entity/get-book-entity';
import {
  getCharacterScenes,
  type CharacterScene
} from '@/worker/db/models/chapter-scene/get-scenes';
import { createWorkflowFunction, type WorkflowContext } from '@/worker/handler';
import { getProvider } from '@/worker/providers';

const PERSONALITY_MAX_CHARS = 10_000;
const SCENARIO_PERSONALITY_MAX_CHARS = 4_000;
const SCENARIO_START_SCRIPT_MAX_CHARS = 1_500;

export interface PrepareAvatarPayload {
  characterId: string;
  artStyle: string;
}

export interface PrepareAvatarResult {
  characterId: string;
  imageUrl: string;
  personality: string;
  selectedArcFriendlyId: string | null;
}

export async function prepareAvatar(
  payload: PrepareAvatarPayload
): Promise<PrepareAvatarResult> {
  await ensureDbReady();
  return runPrepareAvatar({ executionId: uuidv7(), payload });
}

interface ArcRow {
  friendlyId: string;
  title: string | null;
  content: string;
}

const runPrepareAvatar = createWorkflowFunction<
  PrepareAvatarPayload,
  PrepareAvatarPayload,
  PrepareAvatarResult
>(
  {
    name: 'Prepare avatar'
  },
  async ({ characterId, artStyle }, ctx): Promise<PrepareAvatarResult> => {
    if (host.bookId === null) {
      throw new UnrecoverableError(
        'prepareAvatar requires a bookId — launch from a book'
      );
    }
    const bookId = host.bookId;

    const character = await getBookEntityById(characterId);
    if (!character || character.type !== 'CHARACTER') {
      throw new UnrecoverableError('Selected character not found');
    }

    const [
      characterArcs,
      appearanceArcs,
      isolatedAppearanceArcs,
      relationshipArcs,
      scenes
    ] = await Promise.all([
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['CHARACTER'], [characterId]),
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['APPEARANCE'], [characterId]),
      getBookArcsByBookIdAndTypesAndEntityIds(
        bookId,
        ['APPEARANCE_ISOLATED'],
        [characterId]
      ),
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['RELATIONSHIP'], [characterId]),
      getCharacterScenes(bookId, character.name)
    ]);

    if (characterArcs.length === 0) {
      throw new UnrecoverableError(
        `No CHARACTER arcs found for ${character.name} — cannot build a personality.`
      );
    }

    const portraitArcs = pickPortraitArcs(
      appearanceArcs,
      isolatedAppearanceArcs,
      character.description
    );

    ctx.log
      .withMetadata({
        character: character.name,
        characterArcs: characterArcs.length,
        relationshipArcs: relationshipArcs.length,
        scenes: scenes.length,
        portraitArcs: portraitArcs.length
      })
      .info('Generating personality, portrait, and scenarios in parallel');

    const [personality, portrait, scenarios] = await Promise.all([
      generatePersonality(character.name, characterArcs, ctx),
      generatePortrait(
        character.name,
        character.label,
        portraitArcs,
        characterId,
        artStyle,
        ctx
      ),
      generateScenarios(character.name, characterArcs, relationshipArcs, scenes, ctx)
    ]);

    await upsertAvatar({
      characterId,
      bookId,
      imageUrl: portrait.imageUrl,
      personality,
      artStyle,
      selectedArcFriendlyId: portrait.selectedArcFriendlyId
    });

    await replaceScenarios(bookId, characterId, scenarios);
    ctx.log.withMetadata({ scenarios: scenarios.length }).info('Scenarios saved');

    ctx.log
      .withMetadata({ characterId, imageUrl: portrait.imageUrl })
      .info('Avatar prepared');

    return {
      characterId,
      imageUrl: portrait.imageUrl,
      personality,
      selectedArcFriendlyId: portrait.selectedArcFriendlyId
    };
  }
);

// Prefer cumulative appearance arcs, then isolated, then the bare entity description.
function pickPortraitArcs(
  appearanceArcs: ArcRow[],
  isolatedArcs: ArcRow[],
  fallback: string | null
): ArcRow[] {
  if (appearanceArcs.length > 0) return appearanceArcs;
  if (isolatedArcs.length > 0) return isolatedArcs;
  if (fallback) return [{ friendlyId: 'description', title: null, content: fallback }];
  return [];
}

async function generatePersonality(
  name: string,
  arcs: ArcRow[],
  ctx: WorkflowContext
): Promise<string> {
  // Name withheld from the prompt so it never lands in the persona
  const promptText = characterPersonality.render({
    character: {
      arcs: arcs.map((a) => ({
        friendlyId: a.friendlyId,
        title: a.title ?? undefined,
        content: a.content
      }))
    },
    maxChars: PERSONALITY_MAX_CHARS - 500
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('text');
  const message = await completeOrThrow(
    model,
    { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);

  const ast = parse(getAssistantText(message));
  const personality = getText(querySelector(ast, 'personality')).trim();
  if (!personality) {
    throw new RecoverableError(`Empty personality generated for ${name}`);
  }
  return personality.slice(0, PERSONALITY_MAX_CHARS);
}

async function generatePortrait(
  name: string,
  label: string | null,
  arcs: ArcRow[],
  characterId: string,
  artStyle: string,
  ctx: WorkflowContext
): Promise<{ imageUrl: string; selectedArcFriendlyId: string | null }> {
  if (arcs.length === 0) {
    throw new UnrecoverableError(
      `No appearance data for ${name} — cannot draw a portrait`
    );
  }

  const promptText = characterPortrait.render({
    character: {
      name,
      label: label ?? undefined,
      arcs: arcs.map((a) => ({ friendlyId: a.friendlyId, content: a.content }))
    }
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('text');
  const message = await completeOrThrow(
    model,
    { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);

  const ast = parse(getAssistantText(message));
  const portraitEl = querySelector(ast, 'portrait');
  const description = portraitEl
    ? getText(querySelector(portraitEl, 'description')).trim()
    : '';
  if (!description) {
    throw new RecoverableError(`Empty portrait description for ${name}`);
  }

  const rawArcId = portraitEl
    ? getText(querySelector(portraitEl, 'arc_id')).trim() || null
    : null;
  const selectedArcFriendlyId =
    arcs.find((a) => a.friendlyId === rawArcId)?.friendlyId ??
    arcs[0]?.friendlyId ??
    null;

  const imagePrompt = [
    `Create a front-facing reference portrait of ${name}.`,
    description,
    '',
    'Requirements:',
    '- Head and shoulders through upper chest, facing the camera directly, looking at the viewer',
    '- Calm, natural expression with eyes open and mouth closed',
    `- Rendered in a ${resolveArtStyle(artStyle)}`,
    '- Even, flattering lighting on the face',
    '- Plain, solid neutral background with no props, scenery, or other people',
    '- Centered face, sharp focus, no text, captions, or watermarks'
  ].join('\n');

  ctx.log.withMetadata({ name, selectedArcFriendlyId }).info('Generating portrait image');

  const { data, mimeType } = await generateOneShotImage(
    getProvider('image_generation_reference'),
    { prompt: imagePrompt, aspectRatio: '16:9' }
  );

  const key = `avatar-reference/${characterId}-${uuidv7()}`;
  const imageUrl = buildAssetUrl(key, mimeType);
  await ctx.fs.write(parseAssetUrl(imageUrl).relPath, data);

  return { imageUrl, selectedArcFriendlyId };
}

interface ScenarioArc {
  title: string | null;
  content: string;
  startChapterIdx: number;
  endChapterIdx: number;
}

const MAX_SCENES_IN_PROMPT = 60;

async function generateScenarios(
  name: string,
  characterArcs: ScenarioArc[],
  relationshipArcs: ScenarioArc[],
  scenes: CharacterScene[],
  ctx: WorkflowContext
): Promise<ScenarioInput[]> {
  const promptText = characterScenarios.render({
    characterArcs: characterArcs.map(toPromptArc),
    relationshipArcs: relationshipArcs.map(toPromptArc),
    scenes: scenes.slice(0, MAX_SCENES_IN_PROMPT).map((s) => ({
      title: s.title,
      chapterIdx: s.chapterIdx,
      setting: s.setting ?? undefined
    })),
    maxPersonalityChars: SCENARIO_PERSONALITY_MAX_CHARS,
    maxStartScriptChars: SCENARIO_START_SCRIPT_MAX_CHARS
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('text');
  const message = await completeOrThrow(
    model,
    { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);

  const ast = parse(getAssistantText(message));
  const elements = querySelectorAll(ast, 'scenario');

  const scenarios: ScenarioInput[] = [];
  const seenModes = new Set<string>();
  elements.forEach((el, index) => {
    const mode = getText(querySelector(el, 'mode')).trim();
    const label = getText(querySelector(el, 'label')).trim();
    const tagline = getText(querySelector(el, 'tagline')).trim();
    const personality = getText(querySelector(el, 'personality')).trim();
    const startScript = getText(querySelector(el, 'start_script')).trim();
    const anchorTitle = getText(querySelector(el, 'anchor_scene')).trim();

    if (!isScenarioMode(mode) || seenModes.has(mode)) return;
    if (!label || !personality || !startScript) return;
    seenModes.add(mode);

    const anchorChapterIdx = matchAnchorChapter(anchorTitle, scenes);
    const knowledge = buildKnowledge({
      name,
      characterArcs,
      relationshipArcs,
      scenes,
      anchorChapterIdx
    });

    scenarios.push({
      scenarioKey: mode,
      mode,
      label,
      tagline,
      startScript: startScript.slice(0, SCENARIO_START_SCRIPT_MAX_CHARS),
      personality: personality.slice(0, SCENARIO_PERSONALITY_MAX_CHARS),
      knowledge,
      knowledgeHash: hashContent(knowledge),
      anchorChapterIdx,
      sortOrder: index
    });
  });

  if (scenarios.length === 0) {
    throw new RecoverableError(`No scenarios generated for ${name}`);
  }
  return scenarios;
}

function toPromptArc(arc: ScenarioArc) {
  return {
    friendlyId: '',
    title: arc.title ?? undefined,
    startChapterIdx: arc.startChapterIdx,
    endChapterIdx: arc.endChapterIdx,
    content: arc.content
  };
}

// Match the LLM's chosen scene back to a real scene to recover its chapter for clamping.
function matchAnchorChapter(
  anchorTitle: string,
  scenes: CharacterScene[]
): number | null {
  if (!anchorTitle) return null;
  const normalized = anchorTitle.toLowerCase();
  const exact = scenes.find((s) => s.title.toLowerCase() === normalized);
  if (exact) return exact.chapterIdx;
  const partial = scenes.find(
    (s) =>
      s.title.toLowerCase().includes(normalized) ||
      normalized.includes(s.title.toLowerCase())
  );
  return partial?.chapterIdx ?? null;
}

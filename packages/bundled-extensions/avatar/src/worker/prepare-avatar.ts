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
import {
  completeOrThrow,
  getAssistantText,
  watchAgent
} from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { Agent } from '@earendil-works/pi-agent-core';
import { v7 as uuidv7 } from 'uuid';

import {
  createLookupRelatedEntityAppearanceTool,
  getRelatedEntitiesFromArcs
} from '@/lib/lit/related-entities';
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

const PERSONALITY_MAX_CHARS = 1_500;
const SCENARIO_PERSONALITY_MAX_CHARS = 1_500;
const SCENARIO_START_SCRIPT_MAX_CHARS = 1_500;
const MIN_ARC_PERCENTAGE = 5;

interface PrepareAvatarPayload {
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

interface GenerateScenariosPayload {
  characterId: string;
}

export interface GenerateScenariosResult {
  characterId: string;
  count: number;
}

export async function generateAvatarScenarios(
  payload: GenerateScenariosPayload
): Promise<GenerateScenariosResult> {
  await ensureDbReady();
  return runGenerateScenarios({ executionId: uuidv7(), payload });
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

    const [characterArcs, appearanceArcs, relationshipArcs, scenes] = await Promise.all([
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['CHARACTER'], [characterId]),
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['APPEARANCE'], [characterId]),
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['RELATIONSHIP'], [characterId]),
      getCharacterScenes(bookId, character.name)
    ]);

    if (characterArcs.length === 0) {
      throw new UnrecoverableError(
        `No CHARACTER arcs found for ${character.name} — cannot build a personality.`
      );
    }

    const arcsWithSpan = getArcsWithPercentageChapterSpan(appearanceArcs);
    if (arcsWithSpan.length === 0) {
      throw new UnrecoverableError(
        `No appearance arcs found for ${character.name} — cannot draw a portrait.`
      );
    }
    const significantArcs = arcsWithSpan.filter(
      (arc) => arc.percentageChapterSpan >= MIN_ARC_PERCENTAGE
    );
    const portraitArcs = significantArcs.length > 0 ? significantArcs : arcsWithSpan;

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
        bookId,
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

const runGenerateScenarios = createWorkflowFunction<
  GenerateScenariosPayload,
  GenerateScenariosPayload,
  GenerateScenariosResult
>(
  {
    name: 'Generate avatar scenarios'
  },
  async ({ characterId }, ctx): Promise<GenerateScenariosResult> => {
    if (host.bookId === null) {
      throw new UnrecoverableError(
        'generateAvatarScenarios requires a bookId — launch from a book'
      );
    }
    const bookId = host.bookId;

    const character = await getBookEntityById(characterId);
    if (!character || character.type !== 'CHARACTER') {
      throw new UnrecoverableError('Selected character not found');
    }

    const [characterArcs, relationshipArcs, scenes] = await Promise.all([
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['CHARACTER'], [characterId]),
      getBookArcsByBookIdAndTypesAndEntityIds(bookId, ['RELATIONSHIP'], [characterId]),
      getCharacterScenes(bookId, character.name)
    ]);

    if (characterArcs.length === 0) {
      throw new UnrecoverableError(
        `No CHARACTER arcs found for ${character.name} — cannot build scenarios.`
      );
    }

    ctx.log
      .withMetadata({
        character: character.name,
        characterArcs: characterArcs.length,
        relationshipArcs: relationshipArcs.length,
        scenes: scenes.length
      })
      .info('Generating scenarios');

    const scenarios = await generateScenarios(
      character.name,
      characterArcs,
      relationshipArcs,
      scenes,
      ctx
    );

    await replaceScenarios(bookId, characterId, scenarios);
    ctx.log.withMetadata({ scenarios: scenarios.length }).info('Scenarios saved');

    return { characterId, count: scenarios.length };
  }
);

// Returns arcs with their percentage chapter span (relative to total chapters covered).
function getArcsWithPercentageChapterSpan<
  T extends { startChapterIdx?: number | null; endChapterIdx?: number | null }
>(arcs: T[]): Array<T & { percentageChapterSpan: number }> {
  if (arcs.length === 0) return [];

  const maxEndChapter = Math.max(...arcs.map((a) => a.endChapterIdx ?? 0));
  const totalChapters = maxEndChapter + 1;

  return arcs.map((arc) => {
    const startIdx = arc.startChapterIdx ?? 0;
    const endIdx = arc.endChapterIdx ?? 0;
    const chapterSpan = Math.abs(endIdx - startIdx) + 1;
    const percentageChapterSpan =
      totalChapters > 0 ? (chapterSpan / totalChapters) * 100 : 0;
    return { ...arc, percentageChapterSpan };
  });
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
  bookId: string,
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

  const baseDescription = arcs[0]?.content ?? '';
  const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
    bookId,
    bookEntityIds: [characterId],
    searchTextForMentions: baseDescription
  });
  const relatedEntities = relatedEntitiesResult.entities.filter(
    (e) => e.type !== 'CHARACTER' && e.type !== 'PLACE'
  );
  const hasRelatedEntities = relatedEntities.length > 0;

  const { model, apiKey, reasoning } = ctx.getPiModel('text');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: hasRelatedEntities
        ? [
            createLookupRelatedEntityAppearanceTool(
              bookId,
              relatedEntitiesResult.contextEntityIds,
              `visual appearance as visible on the head, shoulders, and neck while clothed, in a few concise sentences. Ignore or explicitly note as not visible any traits below the shoulders/neck (e.g., arm tattoos, belt accessories, leg armor). Prioritize describing how this entity appears on this specific character: ${name}. If the data includes appearance details for them, focus on those. Otherwise, write a generalized description of the entity's common form, noting any variation in how it manifests across characters.`,
              ctx
            )
          ]
        : []
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent('generateCharacterPortrait', agent, ctx, 'portrait');

  const promptText = characterPortrait.render({
    character: {
      name,
      label: label ?? undefined,
      arcs: arcs.map((a) => ({ friendlyId: a.friendlyId, content: a.content }))
    },
    relatedEntities: hasRelatedEntities ? relatedEntities : undefined
  });

  try {
    await agent.prompt(promptText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Portrait description generation aborted');
    } else {
      throw e;
    }
  }

  if (!watcher.xml) {
    throw new RecoverableError(`Failed to generate portrait description for ${name}`);
  }

  const ast = parse(watcher.xml);
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
    '- Calm, natural expression with eyes open and, if the character has a mouth, lips parted slightly',
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

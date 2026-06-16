import dedent from 'dedent';
import slug from 'slug';
import { v7 as uuidv7 } from 'uuid';

import { findClosestArcForEntity } from '@/lib/chat/closest-arc';
import { detectOutOfSceneMentions } from '@/lib/chat/detect-out-of-scene-mentions';
import { buildFriendlyIdMap } from '@/lib/chat/friendly-id-map';
import type { Chat } from '@/lib/db/types';
import chatV2 from '@/lib/prompts/chat/chat-v2';
import { ensureDbReady, getDb } from '@/worker/db';
import {
  getBookArcsByBookIdAndTypesAndEntityIds,
  getBookArcsByIds,
  getBookArcWithChaptersById,
  getEntitiesWithAppearanceArcByBookIds
} from '@/worker/db/models/book-arc/get-book-arc';
import {
  getBookEntitiesByIds,
  getBookEntityNamesByBookIdsAndTypesAndSignificanceTiers
} from '@/worker/db/models/book-entity/get-book-entity';
import { getBookInteractiveEntitiesByInteractiveTypeAndBookIds } from '@/worker/db/models/book-interactive-entity/get-book-interactive-entity';
import { getBookStylesByBookIdAndIsMajorityOrPovBookEntityId } from '@/worker/db/models/book-style/get-book-style';
import { createChatEntities } from '@/worker/db/models/chat-entity/create-chat-entity';
import { createChatNodePart } from '@/worker/db/models/chat-node-part/create-chat-node-part';
import { createChatNode } from '@/worker/db/models/chat-node/create-chat-node';
import { createChat } from '@/worker/db/models/chat/create-chat';
import { getChatByUserIdAndSlug } from '@/worker/db/models/chat/get-chat';
import { updateChatById } from '@/worker/db/models/chat/update-chat';
import { getScenarioWithEntitiesById } from '@/worker/db/models/scenario/get-scenario';
import { getUserWorldByUserIdAndSlug } from '@/worker/db/models/user-world/get-user-world';
import { DEFAULT_CHAT_IMAGE_PROVIDER_KEY } from '@/worker/providers';

import { DEFAULT_USER_ID } from '../../lib/auth';

export type CreateNewChatParams = {
  scenarioId: string;
  userWorldSlug?: string;
};

export async function createNewChat({
  scenarioId,
  userWorldSlug
}: CreateNewChatParams): Promise<{ chatSlug: string }> {
  await ensureDbReady();
  const scenario = await getScenarioWithEntitiesById(scenarioId);
  if (!scenario) throw new Error('Scenario not found');
  let userWorldId: string | null = null;
  let accessType: Chat['accessType'] = null;
  if (userWorldSlug) {
    const userWorld = await getUserWorldByUserIdAndSlug(DEFAULT_USER_ID, userWorldSlug);
    if (!userWorld) throw new Error('User world not found');
    userWorldId = userWorld.id;
    accessType = userWorld.accessType;
  }
  const bookEntityIds = [
    ...scenario.scenarioEntities.map((e) => e.bookEntityId),
    ...scenario.additionalBookEntityIds
  ];
  const bookArcIds = [
    ...scenario.scenarioEntities.map((e) => e.bookArcId),
    ...scenario.scenarioEntities
      .map((e) => e.appearanceBookArcId)
      .filter((id): id is string => id !== null),
    ...scenario.appellationBookArcIds,
    ...(scenario.relationshipBookArcId ? [scenario.relationshipBookArcId] : [])
  ];
  const [bookEntities, bookArcs] = await Promise.all([
    getBookEntitiesByIds(bookEntityIds),
    getBookArcsByIds(bookArcIds)
  ]);
  const bookEntityMap = new Map(bookEntities.map((e) => [e.id, e]));
  const bookArcMap = new Map(bookArcs.map((a) => [a.id, a]));
  const playerCharacterScenarioEntity = scenario.scenarioEntities.find((se) => {
    const entity = bookEntityMap.get(se.bookEntityId);
    return entity?.type === 'CHARACTER';
  });
  if (!playerCharacterScenarioEntity) {
    throw new Error('Player character is required');
  }
  const playerCharacterEntity = bookEntityMap.get(
    playerCharacterScenarioEntity.bookEntityId
  );
  if (!playerCharacterEntity) {
    throw new Error('Player character entity not found');
  }
  const styleAnalyses = await getBookStylesByBookIdAndIsMajorityOrPovBookEntityId(
    playerCharacterEntity.bookId,
    playerCharacterEntity.id
  );
  const promptArgs = composeChatPromptInput({
    scenario,
    scenarioEntities: scenario.scenarioEntities,
    bookEntityMap,
    bookArcMap,
    styleAnalyses,
    playerCharacterEntityId: playerCharacterEntity.id
  });
  const systemPrompt = chatV2.render(promptArgs);
  const titleSlug = slug(scenario.title);
  let finalSlug = titleSlug;
  await getDb()
    .transaction()
    .execute(async (trx) => {
      const existing = await getChatByUserIdAndSlug(DEFAULT_USER_ID, titleSlug, trx);
      finalSlug = existing
        ? `${titleSlug}-${Math.random().toString(36).substring(2, 8)}`
        : titleSlug;

      const chat = await createChat(
        {
          id: uuidv7(),
          bookIds: scenario.scenarioEntities.map((entity) => entity.bookId),
          slug: finalSlug,
          title: scenario.title,
          toneTags: scenario.toneTags,
          relationshipBookArcId: scenario.relationshipBookArcId,
          appellationBookArcIds: scenario.appellationBookArcIds,
          additionalBookEntityIds: scenario.additionalBookEntityIds,
          userId: DEFAULT_USER_ID,
          organizationId: null,
          scenarioId: scenario.id,
          userWorldId,
          accessType,
          systemPrompt,
          initialImageModel: DEFAULT_CHAT_IMAGE_PROVIDER_KEY,
          currentImageModel: DEFAULT_CHAT_IMAGE_PROVIDER_KEY,
          imageMode: promptArgs.imageMode
        },
        trx
      );

      if (!chat) throw new Error('Failed to create chat');

      await createChatEntities(
        scenario.scenarioEntities.map((entity) => ({
          id: uuidv7(),
          chatId: chat.id,
          bookId: entity.bookId,
          bookEntityId: entity.bookEntityId,
          bookArcId: entity.bookArcId,
          idx: entity.idx,
          appearanceBookArcId: entity.appearanceBookArcId,
          imageUrl: entity.imageUrl
        })),
        trx
      );

      // Pre-populate with all PRIMARY + SECONDARY characters from the chat's books
      const bookIds = [...new Set(scenario.scenarioEntities.map((e) => e.bookId))];
      const allCharacters = await getBookEntityNamesByBookIdsAndTypesAndSignificanceTiers(
        bookIds,
        ['CHARACTER'],
        ['PRIMARY', 'SECONDARY'],
        trx
      );

      const scenarioEntityIds = new Set(
        scenario.scenarioEntities.map((e) => e.bookEntityId)
      );
      const { coreCharacters, extraCharacters } = allCharacters.reduce(
        (acc, c) => {
          if (scenarioEntityIds.has(c.id)) {
            acc.coreCharacters.push(c);
          } else {
            acc.extraCharacters.push(c);
          }
          return acc;
        },
        {
          coreCharacters: [] as typeof allCharacters,
          extraCharacters: [] as typeof allCharacters
        }
      );

      if (extraCharacters.length > 0) {
        // Look up interactive entities for appearance overrides
        const bookInteractiveEntities =
          await getBookInteractiveEntitiesByInteractiveTypeAndBookIds(
            'CHARACTER_VERTICAL', // TODO read from bookSettings
            bookIds,
            trx
          );
        const interactiveEntityByBookEntityId = new Map(
          bookInteractiveEntities.map((bie) => [
            bie.bookEntityId,
            {
              selectedBookArcId: bie.selectedBookArcId,
              croppedImageUrl: bie.croppedImageUrl
            }
          ])
        );

        // Get player character's appearance arc chapter range
        const playerAppearanceArc = playerCharacterScenarioEntity.appearanceBookArcId
          ? await getBookArcWithChaptersById(
              playerCharacterScenarioEntity.appearanceBookArcId,
              trx
            )
          : null;
        const chapterRange = playerAppearanceArc
          ? {
              start: playerAppearanceArc.startChapterIdx,
              end: playerAppearanceArc.endChapterIdx
            }
          : {};

        // Group extra characters by bookId and batch-fetch arcs
        const extraByBookId = new Map<string, typeof extraCharacters>();
        for (const c of extraCharacters) {
          const existing = extraByBookId.get(c.bookId);
          if (existing) existing.push(c);
          else extraByBookId.set(c.bookId, [c]);
        }

        const extraChatEntities: Parameters<typeof createChatEntities>[0] = [];
        let nextIdx = scenario.scenarioEntities.length;

        for (const [bookId, characters] of extraByBookId) {
          const entityIds = characters.map((c) => c.id);
          const arcs = await getBookArcsByBookIdAndTypesAndEntityIds(
            bookId,
            ['APPEARANCE', 'CHARACTER_ISOLATED'],
            entityIds,
            { includeChapters: true, includeEntities: true },
            trx
          );

          const appearanceArcs = arcs.filter((a) => a.type === 'APPEARANCE');
          const characterArcs = arcs.filter((a) => a.type === 'CHARACTER_ISOLATED');

          for (const character of characters) {
            const interactiveEntity = interactiveEntityByBookEntityId.get(character.id);

            const appearanceBookArcId =
              interactiveEntity?.selectedBookArcId ??
              findClosestArcForEntity(character.id, chapterRange, appearanceArcs);
            const closestCharacterArcId = findClosestArcForEntity(
              character.id,
              chapterRange,
              characterArcs
            );
            if (!appearanceBookArcId || !closestCharacterArcId) continue;

            extraChatEntities.push({
              id: uuidv7(),
              chatId: chat.id,
              bookId,
              bookEntityId: character.id,
              bookArcId: closestCharacterArcId,
              idx: nextIdx++,
              appearanceBookArcId,
              imageUrl: interactiveEntity?.croppedImageUrl ?? null
            });
          }
        }

        if (extraChatEntities.length > 0) {
          await createChatEntities(extraChatEntities, trx);
        }
      }

      const chatNode = await createChatNode(
        {
          id: uuidv7(),
          chatId: chat.id,
          parentNodeId: null, // root node
          actionLabel: scenario.title,
          actionType: 'system_init',
          shouldGenerateVisual: true
        },
        trx
      );

      await createChatNodePart(
        {
          id: uuidv7(),
          idx: -1,
          content: '',
          chatNodeId: chatNode.id,
          type: 'INTERNAL_CONTENT',
          subtype: 'entering_characters',
          bookEntityIds: coreCharacters.map((entity) => entity.id)
        },
        trx
      );

      // Persist the opening "begin the scene" user message as a node part
      // so it appears identically in every replay — keeps the prompt cache
      // prefix stable across turns and gives the system_init turn a real
      // user message to continue from.
      await createChatNodePart(
        {
          id: uuidv7(),
          idx: 0,
          content: 'Begin the scene.',
          chatNodeId: chatNode.id,
          type: 'INTERNAL_CONTENT',
          subtype: 'kickoff'
        },
        trx
      );

      // Detect entity mentions in the scenario description and create entering_entities
      const entitiesWithAppearance = bookIds.length
        ? await getEntitiesWithAppearanceArcByBookIds(bookIds, trx)
        : [];

      if (entitiesWithAppearance.length > 0) {
        const alreadyInSceneIds = new Set(coreCharacters.map((c) => c.id));
        const mentionResult = detectOutOfSceneMentions(
          scenario.description,
          entitiesWithAppearance,
          alreadyInSceneIds
        );

        if (mentionResult) {
          const mentionedEntities = entitiesWithAppearance.filter((e) =>
            mentionResult.bookEntityIds.includes(e.id)
          );
          console.log('mentionedEntities!', mentionedEntities);

          const playerAppearanceArcForEntities =
            playerCharacterScenarioEntity.appearanceBookArcId
              ? await getBookArcWithChaptersById(
                  playerCharacterScenarioEntity.appearanceBookArcId,
                  trx
                )
              : null;
          const entityChapterRange = playerAppearanceArcForEntities
            ? {
                start: playerAppearanceArcForEntities.startChapterIdx,
                end: playerAppearanceArcForEntities.endChapterIdx
              }
            : {};

          const entitiesByBookId = new Map<string, typeof mentionedEntities>();
          for (const entity of mentionedEntities) {
            const existing = entitiesByBookId.get(entity.bookId);
            if (existing) existing.push(entity);
            else entitiesByBookId.set(entity.bookId, [entity]);
          }

          for (const [bookId, entities] of entitiesByBookId) {
            const appearanceArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
              bookId,
              ['APPEARANCE'],
              entities.map((e) => e.id),
              { includeChapters: true, includeEntities: true },
              trx
            );

            for (const entity of entities) {
              const closestArcId = findClosestArcForEntity(
                entity.id,
                entityChapterRange,
                appearanceArcs
              );
              const appearanceArc = appearanceArcs.find((a) => a.id === closestArcId);
              if (!appearanceArc) continue;

              await createChatNodePart(
                {
                  id: uuidv7(),
                  chatNodeId: chatNode.id,
                  type: 'INTERNAL_CONTENT',
                  subtype: 'entering_entities',
                  bookEntityIds: [entity.id],
                  idx: -1,
                  content: dedent`
                        ${entity.name} is now relevant to the scene. Use the following appearance description to help inform any following \`generate_visual\` calls involving this entity.

                        <entering_entity>
                          <name>${entity.name}</name>
                          <appearance>
                            ${appearanceArc.content}
                          </appearance>
                          ${entity.names?.length ? `<common_names>\n${entity.names.map((n) => `    ${n}`).join('\n')}\n  </common_names>` : ''}
                        </entering_entity>
                      `
                },
                trx
              );
            }
          }
        }
      }

      await updateChatById(chat.id, { currentLeafNodeId: chatNode.id }, trx);
    });
  return { chatSlug: finalSlug };
}

type StyleAnalysis = NonNullable<
  Awaited<ReturnType<typeof getBookStylesByBookIdAndIsMajorityOrPovBookEntityId>>
>[0];

type BookEntity = Awaited<ReturnType<typeof getBookEntitiesByIds>>[number];
type BookArc = Awaited<ReturnType<typeof getBookArcsByIds>>[number];
type Scenario = NonNullable<Awaited<ReturnType<typeof getScenarioWithEntitiesById>>>;
type ScenarioEntity = Scenario['scenarioEntities'][number];

interface ComposeChatPromptInputParams {
  scenario: Scenario;
  scenarioEntities: ScenarioEntity[];
  bookEntityMap: Map<string, BookEntity>;
  bookArcMap: Map<string, BookArc>;
  styleAnalyses: StyleAnalysis[];
  playerCharacterEntityId: string;
}

function composeChatPromptInput({
  scenario,
  scenarioEntities,
  bookEntityMap,
  bookArcMap,
  styleAnalyses,
  playerCharacterEntityId
}: ComposeChatPromptInputParams) {
  // Find player character's style or fall back to majority
  let playerCharacterStyle: StyleAnalysis | undefined;
  let majorityStyleAnalysis: StyleAnalysis | undefined;
  for (const style of styleAnalyses) {
    if (style.povBookEntityId === playerCharacterEntityId) {
      playerCharacterStyle = style;
    }
    if (style.isMajority) {
      majorityStyleAnalysis = style;
    }
  }
  playerCharacterStyle ??= majorityStyleAnalysis;

  // Build entity name lookup
  const entityNameById = new Map<string, string>();
  for (const [id, entity] of bookEntityMap) {
    entityNameById.set(id, entity.name);
  }

  // Group appellations by source id (bookEntityIds[0] is source, [1] is target)
  const appellationsBySourceId = new Map<string, { target: string; content: string }[]>();
  for (const arcId of scenario.appellationBookArcIds) {
    const arc = bookArcMap.get(arcId);
    if (!arc) continue;

    const [sourceId, targetId] = arc.bookEntityIds;
    const targetName = entityNameById.get(targetId);
    if (!targetName) continue;

    const existing = appellationsBySourceId.get(sourceId);
    const appellation = { target: targetName, content: arc.content };
    if (existing) {
      existing.push(appellation);
    } else {
      appellationsBySourceId.set(sourceId, [appellation]);
    }
  }

  const companionCharacters: Array<{
    friendlyId: string;
    name: string;
    characterArcPhase: { title: string; content: string };
    appearanceArcPhase: { content: string };
    commonNames?: string[];
    appellations?: { target: string; content: string }[];
  }> = [];
  let playerCharacter: (typeof companionCharacters)[number] | undefined;
  let location:
    | {
        name: string;
        locationPhase: { title: string; content: string };
        appearancePhase: { content: string };
      }
    | undefined;

  const friendlyIdMap = buildFriendlyIdMap(
    scenarioEntities
      .map((se) => bookEntityMap.get(se.bookEntityId))
      .filter((e): e is BookEntity => e !== undefined)
  );

  for (const se of scenarioEntities) {
    const bookEntity = bookEntityMap.get(se.bookEntityId);
    const bookArc = bookArcMap.get(se.bookArcId);
    const appearanceBookArc = se.appearanceBookArcId
      ? bookArcMap.get(se.appearanceBookArcId)
      : undefined;

    if (!bookEntity || !bookArc) continue;

    if (bookEntity.type === 'CHARACTER') {
      const character = {
        friendlyId: friendlyIdMap.get(bookEntity.id) ?? bookEntity.friendlyId,
        name: bookEntity.name,
        characterArcPhase: {
          title: bookArc.title,
          content: bookArc.content
        },
        appearanceArcPhase: {
          content: appearanceBookArc?.content ?? ''
        },
        commonNames: bookEntity.names?.length ? bookEntity.names : undefined,
        appellations: appellationsBySourceId.get(bookEntity.id)
      };

      if (!playerCharacter) {
        playerCharacter = character;
      } else {
        companionCharacters.push(character);
      }
    } else if (bookEntity.type === 'PLACE' && !location) {
      location = {
        name: bookEntity.name,
        locationPhase: {
          title: bookArc.title,
          content: bookArc.content
        },
        appearancePhase: {
          content: appearanceBookArc?.content ?? ''
        }
      };
    }
  }

  if (!playerCharacter) {
    throw new Error('Player character is required');
  }
  if (!location) {
    throw new Error('Location is required');
  }

  // Build additional book entities (world elements)
  const additionalBookEntities = scenario.additionalBookEntityIds
    .map((id) => bookEntityMap.get(id))
    .filter((e): e is BookEntity => e !== undefined);

  // Get relationship book arc
  const relationshipBookArc = scenario.relationshipBookArcId
    ? bookArcMap.get(scenario.relationshipBookArcId)
    : undefined;

  return {
    playerCharacter,
    companionCharacters,
    location,
    scenarioTitle: scenario.title,
    scenarioDescription: scenario.description,
    playerCharacterStyle,
    relationshipArcPhase: relationshipBookArc
      ? {
          title: relationshipBookArc.title,
          content: relationshipBookArc.content
        }
      : undefined,
    worldElements: additionalBookEntities.length
      ? additionalBookEntities.map((e) => ({
          name: e.name,
          commonNames: e.names,
          type: e.type,
          description: e.description
        }))
      : undefined,
    imageMode: 'eager' as const // TODO!
  };
}

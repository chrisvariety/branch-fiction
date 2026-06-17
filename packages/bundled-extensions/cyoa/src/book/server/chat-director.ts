import { getAssistantText, completeOrThrow } from '@branch-fiction/extension-sdk/pi-ai';
import dedent from 'dedent';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import {
  findClosestAppellationsForSourceEntity,
  findClosestArcForEntity
} from '@/lib/chat/closest-arc';
import { extractJsonFromResponse } from '@/lib/llm/extract-json';
import chatDirectorPrompt from '@/lib/prompts/chat/chat-director';
import {
  getBookArcsByBookIdAndTypesAndEntityIds,
  getBookArcsByIds,
  getBookArcWithChaptersById,
  getEntitiesWithAppearanceArcByBookIds
} from '@/worker/db/models/book-arc/get-book-arc';
import { createChatNodeParts } from '@/worker/db/models/chat-node-part/create-chat-node-part';
import {
  getChatNodeWithPartsById,
  getInternalContentStateByNodeId
} from '@/worker/db/models/chat-node/get-chat-node';
import { getChatCurrentLeafNodeIdWithEntitiesByUserIdAndSlug } from '@/worker/db/models/chat/get-chat';
import { updateChatById } from '@/worker/db/models/chat/update-chat';
import { getPiModel, INTIMACY_CHAT_IMAGE_PROVIDER_KEY } from '@/worker/providers';

const DirectorResponseSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    intervention_needed: v.picklist([0, 1]),
    categories: v.array(v.picklist(['Entity Entering Scene', 'Escalating Intimacy'])),
    entity_names: v.array(v.string()),
    reasoning: v.string()
  })
);

export async function directChat(
  messages: {
    content: string;
    action: string;
  }[],
  { userId, nodeId, chatSlug }: { userId: string; nodeId: string; chatSlug: string }
): Promise<void> {
  const chatWithEntities = await getChatCurrentLeafNodeIdWithEntitiesByUserIdAndSlug(
    userId,
    chatSlug
  );
  if (!chatWithEntities?.bookIds?.length) return;
  if (!chatWithEntities.currentLeafNodeId) return;

  // Collect internal content state (in-scene entities + tracked subtypes) from node history
  const internalContentState = await getInternalContentStateByNodeId(
    chatWithEntities.currentLeafNodeId
  );
  const enteringCharacterIds =
    internalContentState.get('entering_characters') ?? new Set<string>();
  const enteringEntityIds =
    internalContentState.get('entering_entities') ?? new Set<string>();
  const inSceneIds = new Set([...enteringCharacterIds, ...enteringEntityIds]);

  // All entities with appearance arcs, filtered to those not yet in scene
  const allEntitiesWithAppearance = await getEntitiesWithAppearanceArcByBookIds(
    chatWithEntities.bookIds
  );
  const outOfSceneEntities = allEntitiesWithAppearance.filter(
    (e) => !inSceneIds.has(e.id)
  );

  // Detect out-of-scene entity mentions via LLM
  let mentionedEntityNames: string[] = [];
  let outOfSceneEntityMap = new Map<string, (typeof outOfSceneEntities)[number]>();
  let hasEscalatingIntimacy = false;

  if (outOfSceneEntities.length > 0) {
    const systemPrompt = chatDirectorPrompt.render({
      entities: outOfSceneEntities
    });

    const { model, apiKey } = getPiModel('text');
    const directorMessage = await completeOrThrow(
      model,
      {
        systemPrompt,
        messages: [
          {
            role: 'user',
            content: messages
              .map((message) => `${message.action}: ${message.content}`)
              .join('\n'),
            timestamp: 0
          }
        ]
      },
      { apiKey, sessionId: uuidv7() }
    );

    const directorText = getAssistantText(directorMessage);
    const result = v.parse(DirectorResponseSchema, extractJsonFromResponse(directorText));

    outOfSceneEntityMap = new Map(outOfSceneEntities.map((e) => [e.name, e]));

    // Build alias-to-primary-name lookup for fallback matching
    const aliasToName = new Map<string, string>();
    for (const e of outOfSceneEntities) {
      aliasToName.set(e.name.toLowerCase(), e.name);
      for (const alias of e.names) {
        aliasToName.set(alias.toLowerCase(), e.name);
      }
    }

    // Resolve entity_names to primary names (handles exact match + alias fallback)
    mentionedEntityNames = [
      ...new Set(
        result.entity_names.flatMap((name) => {
          if (outOfSceneEntityMap.has(name)) return [name];
          const resolved = aliasToName.get(name.toLowerCase());
          if (resolved) return [resolved];
          console.warn('Chat Director: Unrecognized entity name in response', name);
          return [];
        })
      )
    ];
    console.log('Chat Director', { result, mentionedEntityNames, nodeId });

    hasEscalatingIntimacy =
      result.intervention_needed === 1 &&
      result.categories.includes('Escalating Intimacy');
  }

  if (!mentionedEntityNames.length && !hasEscalatingIntimacy) return;

  if (
    hasEscalatingIntimacy &&
    chatWithEntities.currentImageModel !== INTIMACY_CHAT_IMAGE_PROVIDER_KEY
  ) {
    console.log('Chat Director: Escalating intimacy detected, switching image model');
    await updateChatById(chatWithEntities.id, {
      currentImageModel: INTIMACY_CHAT_IMAGE_PROVIDER_KEY
    });
  }

  if (!mentionedEntityNames.length) return;

  const node = await getChatNodeWithPartsById(nodeId);
  let nextIdx = (node?.parts.reduce((max, p) => Math.max(max, p.idx), -1) ?? -1) + 1;

  // Bridge from entity name -> chatEntity arc references
  const chatEntityByBookEntityId = new Map(
    chatWithEntities.chatEntities.map((ce) => [ce.bookEntityId, ce])
  );

  // Get player character's appearance arc chapter range (for appellation resolution)
  const playerAppearanceArcId = chatWithEntities.chatEntities[0]?.appearanceBookArcId;
  const playerCharacterAppearanceArc = playerAppearanceArcId
    ? await getBookArcWithChaptersById(playerAppearanceArcId)
    : null;
  const chapterRange = playerCharacterAppearanceArc
    ? {
        start: playerCharacterAppearanceArc.startChapterIdx,
        end: playerCharacterAppearanceArc.endChapterIdx
      }
    : {};

  // Resolve entering entities from the LLM response
  const enteringEntities = mentionedEntityNames.flatMap((name) => {
    const entity = outOfSceneEntityMap.get(name);
    if (!entity) {
      console.warn('Chat Director: Could not find entity', name);
      return [];
    }
    return [entity];
  });

  // Batch-load arcs for character entities (those with a chatEntity)
  const arcIdsToLoad = enteringEntities.flatMap((e) => {
    const ce = chatEntityByBookEntityId.get(e.id);
    if (!ce) return [];
    return [ce.bookArcId, ce.appearanceBookArcId].filter((id): id is string => !!id);
  });
  const arcs = arcIdsToLoad.length > 0 ? await getBookArcsByIds(arcIdsToLoad) : [];
  const arcById = new Map(arcs.map((a) => [a.id, a]));

  for (const entity of enteringEntities) {
    const ce = chatEntityByBookEntityId.get(entity.id);

    if (ce) {
      // Character path: use pre-resolved arc references from chatEntity
      const characterArc = arcById.get(ce.bookArcId);
      const appearanceArc = ce.appearanceBookArcId
        ? arcById.get(ce.appearanceBookArcId)
        : undefined;

      if (!characterArc) {
        console.warn('Chat Director: Missing character arc for', entity.name);
        continue;
      }
      if (!appearanceArc) {
        console.warn('Chat Director: Missing appearance arc for', entity.name);
        continue;
      }

      // Resolve appellations targeting in-scene entities
      const appellationArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
        ce.bookId,
        ['APPELLATION_ISOLATED'],
        [ce.bookEntityId, ...inSceneIds],
        { includeChapters: true, includeEntities: true }
      );
      const closestAppellationArcIds = findClosestAppellationsForSourceEntity(
        ce.bookEntityId,
        inSceneIds,
        chapterRange,
        appellationArcs
      );
      const appellations = closestAppellationArcIds.flatMap((arcId) => {
        const arc = appellationArcs.find((a) => a.id === arcId);
        if (!arc) return [];
        const targetEntity = arc.bookEntities?.find((e) => e.id !== ce.bookEntityId);
        if (!targetEntity) return [];
        return [{ target: targetEntity.name, content: arc.content }];
      });

      console.log(
        `${entity.name} is entering the scene and can now be used for visuals.`
      );

      await createChatNodeParts([
        {
          id: uuidv7(),
          chatNodeId: nodeId,
          type: 'INTERNAL_CONTENT',
          subtype: 'entering_characters',
          bookEntityIds: [entity.id],
          idx: nextIdx++,
          content: dedent`
            ${entity.name} is entering the scene. You may now include them in \`generate_visual\` character_ids.

            <entering_character>
              <id>${entity.friendlyId}</id>
              <name>${entity.name}</name>
              <phase>${characterArc.title ?? 'Untitled'}</phase>
              <character_state>
                ${characterArc.content}
              </character_state>
              <appearance>
                ${appearanceArc.content}
              </appearance>
              ${entity.names?.length ? `<common_names>\n${entity.names.map((n) => `    ${n}`).join('\n')}\n  </common_names>` : ''}
              ${appellations.length ? `<appellations>\n${appellations.map((a) => `    <appellation target="${a.target}">\n      ${a.content}\n    </appellation>`).join('\n')}\n  </appellations>` : ''}
            </entering_character>
          `
        }
      ]);
    } else {
      // Non-character path: find the closest appearance arc directly
      const appearanceArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
        entity.bookId,
        ['APPEARANCE'],
        [entity.id],
        { includeChapters: true, includeEntities: true }
      );
      const closestAppearanceArcId = findClosestArcForEntity(
        entity.id,
        chapterRange,
        appearanceArcs
      );
      const appearanceArc = appearanceArcs.find((a) => a.id === closestAppearanceArcId);

      if (!appearanceArc) {
        console.warn('Chat Director: Missing appearance arc for', entity.name);
        continue;
      }

      console.log(`${entity.name} is now relevant to the scene.`);

      await createChatNodeParts([
        {
          id: uuidv7(),
          chatNodeId: nodeId,
          type: 'INTERNAL_CONTENT',
          subtype: 'entering_entities',
          bookEntityIds: [entity.id],
          idx: nextIdx++,
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
        }
      ]);
    }
  }
}

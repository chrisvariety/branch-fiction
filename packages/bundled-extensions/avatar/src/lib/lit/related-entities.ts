import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import { type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { v7 as uuidv7 } from 'uuid';

import {
  getBookArcsByBookIdAndTypesAndEntityIdsWithEntities,
  getBookArcsByBookIdAndTypesAndFirstEntityId
} from '@/worker/db/models/book-arc/get-book-arc';
import {
  getBookEntitiesByBookId,
  getBookEntityByBookIdAndFriendlyId
} from '@/worker/db/models/book-entity/get-book-entity';
import type { WorkflowContext } from '@/worker/handler';

import { gatherMentions } from './gather-mentions';

export type RelatedEntityArcResult = {
  id: string;
  friendlyId: string;
  name: string;
  type: string;
  summary: string;
  phrasesUsed?: string;
};

export type RelatedEntitiesResult = {
  entities: RelatedEntityArcResult[];
  contextEntityIds: string[];
};

export async function getRelatedEntitiesFromArcs({
  bookId,
  bookEntityIds,
  searchTextForMentions
}: {
  bookId: string;
  bookEntityIds: string[];
  searchTextForMentions?: string;
}): Promise<RelatedEntitiesResult> {
  const originalEntityIds = new Set(bookEntityIds);
  const inputEntityIds = new Set(bookEntityIds);
  const phrasesByEntityId = new Map<string, string[]>();

  if (searchTextForMentions) {
    const allBookEntities = await getBookEntitiesByBookId(bookId);
    const mentionedEntities = gatherMentions(searchTextForMentions, allBookEntities);
    for (const entity of mentionedEntities) {
      inputEntityIds.add(entity.id);
      if (entity.phrasesMentioned.length > 0) {
        phrasesByEntityId.set(entity.id, entity.phrasesMentioned);
      }
    }
  }

  const arcs = await getBookArcsByBookIdAndTypesAndEntityIdsWithEntities(
    bookId,
    ['RELATED_RELATIONSHIP'],
    Array.from(inputEntityIds)
  );

  if (arcs.length === 0) {
    return { entities: [], contextEntityIds: Array.from(inputEntityIds) };
  }

  const results: RelatedEntityArcResult[] = [];
  const seenEntityIds = new Set<string>();

  for (const arc of arcs) {
    if (!arc.bookEntities || arc.bookEntities.length === 0) continue;

    const firstEntityId = arc.bookEntityIds[0];
    const relatedEntity = arc.bookEntities.find((e) => e.id === firstEntityId);
    if (!relatedEntity) continue;
    if (originalEntityIds.has(relatedEntity.id)) continue;
    if (seenEntityIds.has(relatedEntity.id)) continue;
    seenEntityIds.add(relatedEntity.id);

    const phrases = phrasesByEntityId.get(relatedEntity.id);
    const phrasesUsed =
      phrases &&
      phrases.length > 0 &&
      !(phrases.length === 1 && phrases[0] === relatedEntity.name)
        ? phrases.join(', ')
        : undefined;

    results.push({
      id: relatedEntity.id,
      friendlyId: relatedEntity.friendlyId,
      name: relatedEntity.name,
      type: relatedEntity.type,
      summary: arc.title,
      ...(phrasesUsed && { phrasesUsed })
    });
  }

  return { entities: results, contextEntityIds: Array.from(inputEntityIds) };
}

const lookupRelatedEntitySchema = Type.Object({
  id: Type.String({ description: 'The entity ID from the related_entities list' })
});

export function createLookupRelatedEntityAppearanceTool(
  bookId: string,
  contextEntityIds: string[],
  summarizePrompt: string,
  ctx: WorkflowContext
): AgentTool<typeof lookupRelatedEntitySchema> {
  return {
    name: 'lookup_related_entity_appearance',
    label: 'Lookup Related Entity Appearance',
    description:
      'Retrieves detailed visual information about a related entity using its ID from the related_entities list',
    parameters: lookupRelatedEntitySchema,
    execute: async (_id, args) => {
      const { id } = args;

      const entity = await getBookEntityByBookIdAndFriendlyId(bookId, id);
      if (!entity) {
        return {
          content: [{ type: 'text', text: `Entity with ID "${id}" not found.` }],
          details: {}
        };
      }

      const arcs = await getBookArcsByBookIdAndTypesAndFirstEntityId(
        bookId,
        ['RELATED_RELATIONSHIP'],
        entity.id,
        contextEntityIds
      );

      if (arcs.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No appearance information found for entity "${entity.name}" (${id}).`
            }
          ],
          details: {}
        };
      }

      const groupedArcs = new Map<
        string,
        {
          arcs: typeof arcs;
          entities: Array<{ friendlyId: string; name: string; type: string }>;
        }
      >();

      for (const arc of arcs) {
        const prefix = arc.friendlyIdPrefix;
        if (!groupedArcs.has(prefix)) {
          const entities = (arc.bookEntities || [])
            .filter((e) => e.id !== entity.id)
            .map((e) => ({ friendlyId: e.friendlyId, name: e.name, type: e.type }));
          groupedArcs.set(prefix, { arcs: [], entities });
        }
        groupedArcs.get(prefix)!.arcs.push(arc);
      }

      const groupsXml = Array.from(groupedArcs.entries())
        .map(([prefix, group]) => {
          const entitiesAttr = group.entities.map((e) => e.name).join(', ');
          const snapshotsXml = group.arcs
            .map((arc) => {
              const chapters =
                arc.startChapterIdx && arc.endChapterIdx
                  ? `${arc.startChapterIdx}-${arc.endChapterIdx}`
                  : 'unknown';
              return `<snapshot chapters="${chapters}"><summary>${arc.title}</summary><detail>${arc.content}</detail></snapshot>`;
            })
            .join('\n');
          return `<snapshot_group id="${prefix.replace(/-$/, '')}" involved_entities="${entitiesAttr}">\n${snapshotsXml}\n</snapshot_group>`;
        })
        .join('\n');

      const result = `<related_entity id="${entity.friendlyId}" name="${entity.name}" type="${entity.type}">\n${groupsXml}\n</related_entity>`;

      const { model, apiKey, reasoning } = ctx.getPiModel('text');
      const message = await completeOrThrow(
        model,
        {
          messages: [
            {
              role: 'user',
              content: `Please summarize the following to focus on ${summarizePrompt}: ${result}`,
              timestamp: Date.now()
            }
          ]
        },
        { apiKey, reasoning, sessionId: uuidv7() }
      );
      ctx.trackUsage(message);
      return {
        content: [{ type: 'text', text: getAssistantText(message) }],
        details: {}
      };
    }
  };
}

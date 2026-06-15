import { sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/sqlite';

import { getDb } from '@/iframe/db';
import type { Chat, Scenario } from '@/lib/db/types';

export async function getChatSlugsByUserIdAndScenarioIds(
  userId: Chat['userId'],
  scenarioIds: Scenario['id'][]
) {
  if (scenarioIds.length === 0) return [];
  const rows = await getDb()
    .selectFrom('chats')
    .select(['scenarioId', 'slug', 'title'])
    .where('userId', '=', userId)
    .where('scenarioId', 'in', scenarioIds)
    .execute();
  return rows.flatMap((row) =>
    row.scenarioId
      ? [{ scenarioId: row.scenarioId, slug: row.slug, title: row.title }]
      : []
  );
}

export async function getChatWithUserWorldByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug']
) {
  return getDb()
    .selectFrom('chats')
    .select(['id', 'title', 'currentLeafNodeId', 'bookIds', 'accessType', 'imageMode'])
    .select((eb) => [
      jsonObjectFrom(
        eb
          .selectFrom('userWorlds')
          .select(['id', 'slug', 'title'])
          .whereRef('userWorlds.id', '=', 'chats.userWorldId')
          .limit(1)
      ).as('userWorld'),
      jsonArrayFrom(
        eb
          .selectFrom('chatEntities')
          .innerJoin('bookEntities', 'bookEntities.id', 'chatEntities.bookEntityId')
          .leftJoin('characterRefs', (join) =>
            join
              .onRef('characterRefs.characterId', '=', 'bookEntities.id')
              .onRef('characterRefs.bookId', '=', 'bookEntities.bookId')
          )
          .select([
            'chatEntities.bookEntityId',
            'chatEntities.imageUrl',
            'characterRefs.imageUrl as refImageUrl',
            'bookEntities.name',
            'bookEntities.names',
            'bookEntities.type'
          ])
          .whereRef('chatEntities.chatId', '=', 'chats.id')
          .orderBy('chatEntities.idx', 'asc')
      ).as('chatEntities')
    ])
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

export async function getChatNodeCountByChatId(chatId: Chat['id']) {
  const result = await getDb()
    .selectFrom('chatNodes')
    .where('chatId', '=', chatId)
    .select(getDb().fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(result.count);
}

export async function getChatHistoryFromCurrentLeafNodeByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug']
) {
  return getDb()
    .withRecursive('nodePath', (cte) =>
      cte
        .selectFrom('chatNodes')
        .select([
          'chatNodes.id',
          'chatNodes.parentNodeId',
          'chatNodes.depth',
          'chatNodes.childrenCount',
          'chatNodes.actionLabel',
          'chatNodes.actionType',
          'chatNodes.systemInstruction',
          'chatNodes.shouldGenerateVisual',
          sql<number>`1`.as('step')
        ])
        .where('chatNodes.id', '=', (eb) =>
          eb
            .selectFrom('chats')
            .select('currentLeafNodeId')
            .where('userId', '=', userId)
            .where('slug', '=', slug)
        )
        .unionAll(
          cte
            .selectFrom('chatNodes')
            .innerJoin('nodePath', 'chatNodes.id', 'nodePath.parentNodeId')
            .select([
              'chatNodes.id',
              'chatNodes.parentNodeId',
              'chatNodes.depth',
              'chatNodes.childrenCount',
              'chatNodes.actionLabel',
              'chatNodes.actionType',
              'chatNodes.systemInstruction',
              'chatNodes.shouldGenerateVisual',
              sql<number>`node_path.step + 1`.as('step')
            ])
        )
    )
    .selectFrom('nodePath')
    .leftJoin('chatNodeParts', 'nodePath.id', 'chatNodeParts.chatNodeId')
    .select([
      'nodePath.id as nodeId',
      'nodePath.parentNodeId',
      'nodePath.depth',
      'nodePath.childrenCount',
      'nodePath.actionLabel',
      'nodePath.actionType',
      'nodePath.systemInstruction',
      'nodePath.shouldGenerateVisual',
      'nodePath.step',
      'chatNodeParts.id as partId',
      'chatNodeParts.type',
      'chatNodeParts.content',
      'chatNodeParts.contentUrl',
      'chatNodeParts.subtype',
      'chatNodeParts.toolCall',
      'chatNodeParts.idx',
      'chatNodeParts.bookEntityIds'
    ])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('chatNodes as childNodes')
          .select([
            'childNodes.id',
            'childNodes.actionLabel',
            'childNodes.actionType',
            'childNodes.childrenCount'
          ])
          .whereRef('childNodes.parentNodeId', '=', 'nodePath.id')
          .where('nodePath.childrenCount', '>=', 1)
          .orderBy('childNodes.createdAt', 'asc')
      ).as('directChildren')
    ])
    .orderBy('nodePath.step', 'desc')
    .orderBy('chatNodeParts.idx', 'asc')
    .execute();
}

export async function getChatNodeWithPartsById(nodeId: string) {
  return getDb()
    .selectFrom('chatNodes')
    .select((eb) => [
      'id',
      'chatId',
      'parentNodeId',
      'actionLabel',
      'depth',
      'childrenCount',
      jsonArrayFrom(
        eb
          .selectFrom('chatNodeParts')
          .select(['id', 'idx', 'content', 'type', 'subtype', 'contentUrl'])
          .whereRef('chatNodeParts.chatNodeId', '=', 'chatNodes.id')
          .orderBy('chatNodeParts.idx', 'asc')
      ).as('parts'),
      jsonArrayFrom(
        eb
          .selectFrom('chatNodes as childNodes')
          .select([
            'childNodes.id',
            'childNodes.depth',
            'childNodes.actionLabel',
            'childNodes.actionType',
            'childNodes.childrenCount'
          ])
          .whereRef('childNodes.parentNodeId', '=', 'chatNodes.id')
      ).as('children')
    ])
    .where('id', '=', nodeId)
    .executeTakeFirst();
}

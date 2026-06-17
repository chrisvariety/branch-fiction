import { parseDbCount } from '@branch-fiction/extension-sdk/db/parse-count';

import type { Chat, ChatNode, Transaction } from '@/lib/db/types';

import { jsonArrayFrom, jsonObjectFrom } from '../../dialect';
import { getDb } from '../../index';

export async function getRecentActionCountByUserId(userId: Chat['userId']) {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await getDb()
    .selectFrom('chatNodes')
    .innerJoin('chats', 'chats.id', 'chatNodes.chatId')
    .where('chats.userId', '=', userId)
    .where('chatNodes.createdAt', '>=', oneMinuteAgo)
    .where('chatNodes.actionType', '!=', 'system_init')
    .select(getDb().fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return count;
}

export async function getNodeCountByChatId(chatId: Chat['id']) {
  const result = await getDb()
    .selectFrom('chatNodes')
    .where('chatId', '=', chatId)
    .select(getDb().fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return parseDbCount(result.count);
}

export async function getChatNodeById(id: ChatNode['id']) {
  return getDb()
    .selectFrom('chatNodes')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getChatNodeWithChatById(id: ChatNode['id']) {
  return getDb()
    .selectFrom('chatNodes')
    .selectAll()
    .select((eb) =>
      jsonObjectFrom(
        eb.selectFrom('chats').selectAll().whereRef('chats.id', '=', 'chatNodes.chatId')
      ).as('chat')
    )
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getChatNodeWithPartsById(id: ChatNode['id']) {
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
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getInternalContentStateByNodeId(nodeId: string, trx?: Transaction) {
  const rows = await (trx || getDb())
    .withRecursive('nodePath', (cte) =>
      cte
        .selectFrom('chatNodes')
        .select(['chatNodes.id', 'chatNodes.parentNodeId'])
        .where('chatNodes.id', '=', nodeId)
        .unionAll(
          cte
            .selectFrom('chatNodes')
            .innerJoin('nodePath', 'chatNodes.id', 'nodePath.parentNodeId')
            .select(['chatNodes.id', 'chatNodes.parentNodeId'])
        )
    )
    .selectFrom('nodePath')
    .innerJoin('chatNodeParts', 'nodePath.id', 'chatNodeParts.chatNodeId')
    .select(['chatNodeParts.bookEntityIds', 'chatNodeParts.subtype'])
    .where('chatNodeParts.type', '=', 'INTERNAL_CONTENT')
    .execute();

  const bookEntityIdsBySubtype = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.subtype) {
      if (!bookEntityIdsBySubtype.has(row.subtype)) {
        bookEntityIdsBySubtype.set(row.subtype, new Set<string>());
      }
      const entityIds = bookEntityIdsBySubtype.get(row.subtype)!;
      for (const id of row.bookEntityIds) {
        entityIds.add(id);
      }
    }
  }
  return bookEntityIdsBySubtype;
}

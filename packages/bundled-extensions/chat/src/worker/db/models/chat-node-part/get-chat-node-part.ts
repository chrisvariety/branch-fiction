import { sql } from 'kysely';

import type { ChatNodePart } from '@/lib/db/types';

import { jsonArrayFrom } from '../../dialect';
import { getDb } from '../../index';

export async function getAllChatNodePartContentUrls() {
  return getDb()
    .selectFrom('chatNodeParts')
    .select(['contentUrl'])
    .where('contentUrl', 'is not', null)
    .execute();
}

export async function getChatNodePartById(id: ChatNodePart['id']) {
  return getDb()
    .selectFrom('chatNodeParts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getChatNodePartsByChatNodeId(
  chatNodeId: ChatNodePart['chatNodeId']
) {
  return getDb()
    .selectFrom('chatNodeParts')
    .selectAll()
    .where('chatNodeId', '=', chatNodeId)
    .orderBy('idx', 'asc')
    .execute();
}

export async function getRandomChatNodeIdWithActions({
  shouldAllowVisual
}: {
  shouldAllowVisual: boolean;
}) {
  const db = getDb();

  if (shouldAllowVisual) {
    // Prefer nodes that have both ACTION parts and a VISUAL part with subtype != 'none'
    const withVisual = await db
      .selectFrom('chatNodeParts')
      .select('chatNodeId as id')
      .where('type', '=', 'ACTION')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('chatNodeParts as vp')
            .select('vp.id')
            .whereRef('vp.chatNodeId', '=', 'chatNodeParts.chatNodeId')
            .where('vp.type', '=', 'VISUAL')
            .where('vp.subtype', '!=', 'none')
            .where(sql`json_array_length(vp.book_entity_ids)`, '>', 0)
        )
      )
      .orderBy(sql`random()`)
      .limit(1)
      .executeTakeFirst();

    if (withVisual) return withVisual;
  }

  // Fallback: any node with ACTION parts
  return db
    .selectFrom('chatNodeParts')
    .select('chatNodeId as id')
    .where('type', '=', 'ACTION')
    .orderBy(sql`random()`)
    .limit(1)
    .executeTakeFirst();
}

export async function getChatNodePartWithParentVisualById(id: ChatNodePart['id']) {
  return getDb()
    .selectFrom('chatNodeParts')
    .innerJoin('chatNodes', 'chatNodes.id', 'chatNodeParts.chatNodeId')
    .innerJoin('chats', 'chats.id', 'chatNodes.chatId')
    .leftJoin('chatNodes as parentNode', 'parentNode.id', 'chatNodes.parentNodeId')
    .leftJoin('chatNodeParts as parentVisual', (join) =>
      join
        .onRef('parentVisual.chatNodeId', '=', 'parentNode.id')
        .on('parentVisual.type', '=', 'VISUAL')
    )
    .select([
      'chatNodeParts.id',
      'chatNodeParts.content',
      'chatNodeParts.chatNodeId',
      'chatNodeParts.contentUrl',
      'chatNodeParts.bookEntityIds',
      'chats.userId',
      'chats.currentImageModel',
      'parentVisual.content as parentVisualContent',
      'parentVisual.contentUrl as parentVisualContentUrl',
      'parentVisual.bookEntityIds as parentVisualBookEntityIds'
    ])
    .where('chatNodeParts.id', '=', id)
    .executeTakeFirst();
}

export async function getChatEntityAppearancesByChatNodePartId(id: ChatNodePart['id']) {
  return getDb()
    .selectFrom('chatNodeParts')
    .innerJoin('chatNodes', 'chatNodes.id', 'chatNodeParts.chatNodeId')
    .innerJoin('chats', 'chats.id', 'chatNodes.chatId')
    .select(['chats.artStyle'])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('chatEntities')
          .innerJoin('bookEntities', 'bookEntities.id', 'chatEntities.bookEntityId')
          .innerJoin('bookArcs', 'bookArcs.id', 'chatEntities.appearanceBookArcId')
          .select([
            'chatEntities.bookEntityId',
            'chatEntities.imageUrl',
            'bookEntities.name',
            'bookEntities.type',
            'bookArcs.content as appearance'
          ])
          .whereRef('chatEntities.chatId', '=', 'chats.id')
          .where('bookArcs.content', 'is not', null)
          .where(
            sql<boolean>`EXISTS (SELECT 1 FROM json_each(chat_node_parts.book_entity_ids) WHERE value = chat_entities.book_entity_id)`
          )
      ).as('entityAppearances')
    ])
    .where('chatNodeParts.id', '=', id)
    .executeTakeFirst();
}

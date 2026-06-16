import { sql } from 'kysely';

import type { Chat, Transaction } from '@/lib/db/types';

import { jsonArrayFrom, jsonObjectFrom } from '../../dialect';
import { getDb } from '../../index';

export async function getChatIdCurrentLeafNodeIdByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chats')
    .select(['id', 'currentLeafNodeId'])
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

export async function getChatCurrentLeafNodeIdWithEntitiesByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chats')
    .select([
      'id',
      'bookIds',
      'currentLeafNodeId',
      'accessType',
      'imageMode',
      'currentImageModel'
    ])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('chatEntities')
          .select([
            'chatEntities.bookEntityId',
            'chatEntities.bookId',
            'chatEntities.bookArcId',
            'chatEntities.appearanceBookArcId'
          ])
          .whereRef('chatEntities.chatId', '=', 'chats.id')
      ).as('chatEntities')
    ])
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

export async function getChatByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chats')
    .selectAll()
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

export async function getChatWithUserWorldByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chats')
    .select(['id', 'title', 'currentLeafNodeId', 'bookIds', 'accessType'])
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
          .select(['bookEntities.name', 'bookEntities.names', 'bookEntities.type'])
          .whereRef('chatEntities.chatId', '=', 'chats.id')
          .orderBy('chatEntities.idx', 'asc')
      ).as('chatEntities')
    ])
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

export async function getChatTreeNodesByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chatNodes')
    .innerJoin('chats', 'chats.id', 'chatNodes.chatId')
    .leftJoin('chatNodeParts', 'chatNodeParts.chatNodeId', 'chatNodes.id')
    .select([
      'chatNodes.id as nodeId',
      'chatNodes.parentNodeId',
      'chatNodes.depth',
      'chatNodes.childrenCount',
      'chatNodes.actionLabel',
      'chatNodes.actionType',
      'chatNodes.createdAt as nodeCreatedAt',
      'chatNodeParts.id as partId',
      'chatNodeParts.type',
      'chatNodeParts.content',
      'chatNodeParts.contentUrl',
      'chatNodeParts.subtype',
      'chatNodeParts.idx'
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
          .whereRef('childNodes.parentNodeId', '=', 'chatNodes.id')
          .orderBy('childNodes.createdAt', 'asc')
      ).as('directChildren')
    ])
    .where('chats.userId', '=', userId)
    .where('chats.slug', '=', slug)
    .orderBy('chatNodes.depth', 'asc')
    .orderBy('chatNodes.createdAt', 'asc')
    .orderBy('chatNodeParts.idx', 'asc')
    .execute();
}

export async function getChatSlugsByUserIdAndScenarioIds(
  userId: Chat['userId'],
  scenarioIds: Chat['scenarioId'][],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chats')
    .select(['slug', 'scenarioId', 'title'])
    .where('userId', '=', userId)
    .where('scenarioId', 'in', scenarioIds)
    .execute();
}

export async function getLatestChatByUserId(userId: Chat['userId'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('chats')
    .select(['chats.slug', 'chats.title'])
    .select((eb) => [
      eb
        .selectFrom('chatNodeParts')
        .select('chatNodeParts.contentUrl')
        .whereRef('chatNodeParts.chatNodeId', '=', 'chats.currentLeafNodeId')
        .where('chatNodeParts.type', '=', 'VISUAL')
        .where('chatNodeParts.contentUrl', 'is not', null)
        .orderBy('chatNodeParts.idx', 'asc')
        .limit(1)
        .as('coverImageUrl')
    ])
    .where('chats.userId', '=', userId)
    .orderBy('chats.updatedAt', 'desc')
    .limit(1)
    .executeTakeFirst();
}

export async function getLatestChatsByUserId(
  userId: Chat['userId'],
  limit?: number,
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chats')
    .select(['chats.slug', 'chats.title'])
    .select((eb) => [
      eb
        .selectFrom('chatNodeParts')
        .select('chatNodeParts.contentUrl')
        .whereRef('chatNodeParts.chatNodeId', '=', 'chats.currentLeafNodeId')
        .where('chatNodeParts.type', '=', 'VISUAL')
        .where('chatNodeParts.contentUrl', 'is not', null)
        .orderBy('chatNodeParts.idx', 'asc')
        .limit(1)
        .as('coverImageUrl')
    ])
    .where('chats.userId', '=', userId)
    .orderBy('chats.updatedAt', 'desc')
    .$if(limit !== null, (qb) => qb.limit(limit!))
    .execute();
}

export async function getChatWithEntitiesByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chats')
    .selectAll()
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('chatEntities')
          .selectAll()
          .whereRef('chatEntities.chatId', '=', 'chats.id')
      ).as('chatEntities')
    ])
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

export async function getChatWithCurrentLeafNodeByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('chats')
    .select(['id', 'title'])
    .select((eb) => [
      jsonObjectFrom(
        eb
          .selectFrom('chatNodes')
          .select((ebe) => [
            'id',
            'parentNodeId',
            'depth',
            'childrenCount',
            jsonArrayFrom(
              ebe
                .selectFrom('chatNodeParts')
                .select(['id', 'content', 'type', 'subtype', 'contentUrl'])
                .whereRef('chatNodeParts.chatNodeId', '=', 'chatNodes.id')
                .orderBy('chatNodeParts.idx', 'asc')
            ).as('parts'),
            jsonArrayFrom(
              ebe
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
          .whereRef('chatNodes.id', '=', 'chats.currentLeafNodeId')
          .limit(1)
      ).as('currentLeafNode')
    ])
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

export async function getChatHistoryFromCurrentLeafNodeByUserIdAndSlug(
  userId: Chat['userId'],
  slug: Chat['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
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

export async function getNodeAncestryContextByNodeId(nodeId: string, trx?: Transaction) {
  const rows = await (trx || getDb())
    .withRecursive('nodePath', (cte) =>
      cte
        .selectFrom('chatNodes')
        .select(['chatNodes.id', 'chatNodes.parentNodeId', sql<number>`0`.as('step')])
        .where('chatNodes.id', '=', nodeId)
        .unionAll(
          cte
            .selectFrom('chatNodes')
            .innerJoin('nodePath', 'chatNodes.id', 'nodePath.parentNodeId')
            .select([
              'chatNodes.id',
              'chatNodes.parentNodeId',
              sql<number>`node_path.step + 1`.as('step')
            ])
        )
    )
    .selectFrom('nodePath')
    .innerJoin('chatNodeParts', 'nodePath.id', 'chatNodeParts.chatNodeId')
    .select([
      'chatNodeParts.bookEntityIds',
      'chatNodeParts.type',
      'chatNodeParts.subtype',
      'nodePath.step'
    ])
    .where((eb) =>
      eb.or([
        eb.and([
          eb('chatNodeParts.type', '=', 'INTERNAL_CONTENT'),
          eb('chatNodeParts.subtype', '=', 'entity_mention')
        ]),
        eb.and([
          eb('chatNodeParts.type', '=', 'INTERNAL_CONTENT'),
          eb('chatNodeParts.subtype', '=', 'entering_characters')
        ]),
        eb.and([
          eb('chatNodeParts.type', '=', 'VISUAL'),
          eb('chatNodeParts.subtype', '=', 'image')
        ])
      ])
    )
    .execute();

  const alreadyMentionedEntityIds = new Set(
    rows
      .filter(
        (r) =>
          r.type === 'INTERNAL_CONTENT' &&
          (r.subtype === 'entity_mention' || r.subtype === 'entering_characters')
      )
      .flatMap((r) => r.bookEntityIds)
  );

  let nodesSinceLastVisual = Infinity;
  for (const row of rows) {
    if (
      row.type === 'VISUAL' &&
      row.subtype === 'image' &&
      row.step < nodesSinceLastVisual
    ) {
      nodesSinceLastVisual = row.step;
    }
  }

  return { alreadyMentionedEntityIds, nodesSinceLastVisual };
}

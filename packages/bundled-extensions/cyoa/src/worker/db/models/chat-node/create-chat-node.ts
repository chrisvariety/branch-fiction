import type { NewChatNode, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createChatNode(chatNode: NewChatNode, trx?: Transaction) {
  return (trx || getDb())
    .insertInto('chatNodes')
    .values(chatNode)
    .returning(['id', 'depth', 'childrenCount'])
    .executeTakeFirstOrThrow();
}

export async function createChatNodes(chatNodes: NewChatNode[], trx?: Transaction) {
  return (trx || getDb())
    .insertInto('chatNodes')
    .values(chatNodes)
    .returning(['id', 'depth', 'childrenCount'])
    .execute();
}

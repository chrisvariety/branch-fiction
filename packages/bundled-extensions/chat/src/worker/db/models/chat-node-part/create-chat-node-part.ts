import type { NewChatNodePart, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createChatNodePart(
  chatNodePart: NewChatNodePart,
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chatNodeParts')
    .values(chatNodePart)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function createChatNodeParts(
  chatNodeParts: NewChatNodePart[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chatNodeParts')
    .values(chatNodeParts)
    .returning(['id', 'content'])
    .execute();
}

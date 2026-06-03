import type { NewChat, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createChat(chat: NewChat, trx?: Transaction) {
  return (trx || getDb())
    .insertInto('chats')
    .values(chat)
    .returning('id')
    .executeTakeFirst();
}

import { sql } from 'kysely';

import type { Chat, ChatUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateChatById(
  id: Chat['id'],
  chat: ChatUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('chats')
    .set({ ...chat, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', id)
    .execute();
}

export async function updateChatUserIdByUserId(
  oldUserId: Chat['userId'],
  newUserId: Chat['userId'],
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('chats')
    .set({ userId: newUserId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('userId', '=', oldUserId)
    .execute();
}

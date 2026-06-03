import { sql } from 'kysely';

import type { ChatNodePart, ChatNodePartUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateChatNodePartById(
  id: ChatNodePart['id'],
  updates: ChatNodePartUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('chatNodeParts')
    .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', id)
    .execute();
}

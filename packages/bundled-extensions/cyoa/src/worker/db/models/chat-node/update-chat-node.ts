import { sql } from 'kysely';

import type { ChatNode, ChatNodeUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateChatNodeById(
  id: ChatNode['id'],
  chatNode: ChatNodeUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('chatNodes')
    .set({ ...chatNode, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', id)
    .execute();
}

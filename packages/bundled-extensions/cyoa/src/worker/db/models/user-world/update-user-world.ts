import { sql } from 'kysely';

import type { Transaction, UserWorld, UserWorldUpdate } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateUserWorldUserIdByUserId(
  oldUserId: UserWorld['userId'],
  newUserId: UserWorld['userId'],
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('userWorlds')
    .set({ userId: newUserId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('userId', '=', oldUserId)
    .execute();
}

export async function updateUserWorldById(
  id: UserWorld['id'],
  userWorld: UserWorldUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('userWorlds')
    .set({ ...userWorld, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', id)
    .execute();
}

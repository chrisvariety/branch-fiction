import type { BookEntity, BookEntityUpdate } from '@branch-fiction/extension-sdk/db';
import { sql } from 'kysely';

import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateBookEntityById(
  bookEntityId: BookEntity['id'],
  bookEntityUpdate: BookEntityUpdate,
  trx?: Transaction
) {
  const executor = trx || getDb();

  return executor
    .updateTable('bookEntities')
    .set({ ...bookEntityUpdate, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', bookEntityId)
    .execute();
}

export async function updateBookEntitiesByBookId(
  bookId: BookEntity['bookId'],
  bookEntityUpdate: BookEntityUpdate,
  trx?: Transaction
) {
  const executor = trx || getDb();

  return executor
    .updateTable('bookEntities')
    .set({ ...bookEntityUpdate, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('bookId', '=', bookId)
    .execute();
}

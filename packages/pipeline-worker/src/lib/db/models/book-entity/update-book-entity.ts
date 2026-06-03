import { sql } from 'kysely';

import type { BookEntity, BookEntityUpdate, Transaction } from '@/app/lib/db/types';

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

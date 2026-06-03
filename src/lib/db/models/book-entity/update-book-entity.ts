import { sql } from 'kysely';

import type { BookEntityUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateBookEntityById(
  id: string,
  update: BookEntityUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('bookEntities')
    .set({
      ...update,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
}

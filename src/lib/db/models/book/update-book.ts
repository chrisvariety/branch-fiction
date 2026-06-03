import { sql } from 'kysely';

import type { BookUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateBookById(id: string, book: BookUpdate, trx?: Transaction) {
  return (trx || getDb())
    .updateTable('books')
    .set({
      ...book,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
}

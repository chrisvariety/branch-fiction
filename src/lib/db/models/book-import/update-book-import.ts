import { sql } from 'kysely';

import type { BookImportUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateBookImportById(
  id: string,
  bookImport: BookImportUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('bookImports')
    .set({
      ...bookImport,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
}

import { sql } from 'kysely';

import type { ExtensionUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateExtensionById(
  id: string,
  patch: ExtensionUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('extensions')
    .set({
      ...patch,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
}

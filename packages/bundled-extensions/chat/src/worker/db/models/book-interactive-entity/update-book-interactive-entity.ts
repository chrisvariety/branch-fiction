import type { BookInteractiveEntityUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateBookInteractiveEntityById(
  id: string,
  update: BookInteractiveEntityUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('bookInteractiveEntities')
    .set(update)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
}

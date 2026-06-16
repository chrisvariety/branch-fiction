import type { BookInteractive, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function deleteBookInteractiveById(
  bookInteractiveId: BookInteractive['id'],
  trx?: Transaction
) {
  return (trx || getDb())
    .deleteFrom('bookInteractives')
    .where('id', '=', bookInteractiveId)
    .execute();
}

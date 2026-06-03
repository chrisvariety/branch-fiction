import type { NewBookEntity, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createBookEntities(
  bookEntities: NewBookEntity[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('bookEntities')
    .values(bookEntities)
    .returningAll()
    .execute();
}

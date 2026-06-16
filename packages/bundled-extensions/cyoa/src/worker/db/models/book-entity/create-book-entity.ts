import type { NewBookEntity } from '@branch-fiction/extension-sdk/db';

import type { Transaction } from '@/lib/db/types';

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

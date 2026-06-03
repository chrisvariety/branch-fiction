import type { NewBookEntityHierarchy, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createBookEntityHierarchies(
  bookEntityHierarchies: NewBookEntityHierarchy[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('bookEntityHierarchies')
    .values(bookEntityHierarchies)
    .returningAll()
    .execute();
}

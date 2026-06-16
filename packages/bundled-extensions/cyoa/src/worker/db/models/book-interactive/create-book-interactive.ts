import type { NewBookInteractive, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createBookInteractives(
  bookInteractives: NewBookInteractive[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('bookInteractives')
    .values(bookInteractives)
    .returningAll()
    .execute();
}

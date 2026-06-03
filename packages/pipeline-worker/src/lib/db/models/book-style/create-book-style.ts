import type { NewBookStyle, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createBookStyles(bookStyles: NewBookStyle[], trx?: Transaction) {
  return (trx || getDb())
    .insertInto('bookStyles')
    .values(bookStyles)
    .returning(['id'])
    .execute();
}

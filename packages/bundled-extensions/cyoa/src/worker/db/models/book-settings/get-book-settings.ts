import type { BookSettings, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getBookSettings(
  bookId: BookSettings['bookId'],
  trx?: Transaction
): Promise<BookSettings | undefined> {
  return (trx || getDb())
    .selectFrom('bookSettings')
    .selectAll()
    .where('bookId', '=', bookId)
    .executeTakeFirst();
}

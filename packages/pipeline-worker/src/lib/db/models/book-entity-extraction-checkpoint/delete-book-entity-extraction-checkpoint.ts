import type { BookEntityExtractionCheckpoint, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function deleteBookEntityExtractionCheckpointByBookId(
  bookId: BookEntityExtractionCheckpoint['bookId'],
  trx?: Transaction
) {
  return (trx || getDb())
    .deleteFrom('bookEntityExtractionCheckpoints')
    .where('bookId', '=', bookId)
    .execute();
}

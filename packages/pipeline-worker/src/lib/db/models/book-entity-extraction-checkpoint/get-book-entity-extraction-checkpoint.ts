import type { BookEntityExtractionCheckpoint } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function getBookEntityExtractionCheckpointByBookId(
  bookId: BookEntityExtractionCheckpoint['bookId']
) {
  return getDb()
    .selectFrom('bookEntityExtractionCheckpoints')
    .selectAll()
    .where('bookId', '=', bookId)
    .executeTakeFirst();
}

import type { Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function deleteBookCharacterPlaceScoresByBookId(
  bookId: string,
  trx?: Transaction
) {
  return (trx || getDb())
    .deleteFrom('bookCharacterPlaceScores')
    .where('bookId', '=', bookId)
    .execute();
}

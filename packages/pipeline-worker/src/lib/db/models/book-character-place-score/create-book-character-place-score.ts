import type { NewBookCharacterPlaceScore, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createBookCharacterPlaceScores(
  scores: NewBookCharacterPlaceScore[],
  trx?: Transaction
) {
  if (scores.length === 0) return [];

  return (trx || getDb())
    .insertInto('bookCharacterPlaceScores')
    .values(scores)
    .returning(['id'])
    .execute();
}

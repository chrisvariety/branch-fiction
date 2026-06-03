import type { NewChapterEntityAppellation, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createChapterEntityAppellations(
  chapterEntityAppellations: NewChapterEntityAppellation[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chapterEntityAppellations')
    .values(chapterEntityAppellations)
    .returning(['id'])
    .execute();
}

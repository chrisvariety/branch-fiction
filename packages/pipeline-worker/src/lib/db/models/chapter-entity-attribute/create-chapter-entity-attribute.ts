import type { NewChapterEntityAttribute, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createChapterEntityAttributes(
  chapterEntityAttributes: NewChapterEntityAttribute[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chapterEntityAttributes')
    .values(chapterEntityAttributes)
    .returning(['id'])
    .execute();
}

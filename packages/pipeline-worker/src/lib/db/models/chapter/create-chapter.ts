import type { NewChapter, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createChapters(chapters: NewChapter[], trx?: Transaction) {
  return (trx || getDb())
    .insertInto('chapters')
    .values(chapters)
    .returningAll()
    .execute();
}

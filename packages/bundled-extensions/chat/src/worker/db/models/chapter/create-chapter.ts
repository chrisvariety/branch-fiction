import type { NewChapter } from '@branch-fiction/extension-sdk/db';

import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createChapters(chapters: NewChapter[], trx?: Transaction) {
  return (trx || getDb())
    .insertInto('chapters')
    .values(chapters)
    .returningAll()
    .execute();
}

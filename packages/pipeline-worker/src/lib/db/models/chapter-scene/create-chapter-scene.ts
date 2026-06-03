import type { NewChapterScene, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createChapterScenes(
  chapterScenes: NewChapterScene[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chapterScenes')
    .values(chapterScenes)
    .returningAll()
    .execute();
}

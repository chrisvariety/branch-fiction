import type { NewChapterSceneGroup, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createChapterSceneGroups(
  chapterSceneGroups: NewChapterSceneGroup[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chapterSceneGroups')
    .values(chapterSceneGroups)
    .returningAll()
    .execute();
}

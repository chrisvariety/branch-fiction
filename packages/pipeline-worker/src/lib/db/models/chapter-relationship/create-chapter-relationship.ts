import type { NewChapterRelationship, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createChapterRelationships(
  chapterRelationships: NewChapterRelationship[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chapterRelationships')
    .values(chapterRelationships)
    .returning(['id'])
    .execute();
}

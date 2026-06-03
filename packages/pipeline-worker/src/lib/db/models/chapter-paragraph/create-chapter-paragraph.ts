import type { NewChapterParagraph, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createChapterParagraphs(
  chapterParagraphs: NewChapterParagraph[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chapterParagraphs')
    .values(chapterParagraphs)
    .returning(['id'])
    .execute();
}

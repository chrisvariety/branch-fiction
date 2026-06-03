import type { Chapter } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function getChapterById(id: Chapter['id']) {
  return getDb()
    .selectFrom('chapters')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getChapterByBookIdAndChapterIdx(
  bookId: Chapter['bookId'],
  chapterIdx: Chapter['idx']
) {
  return getDb()
    .selectFrom('chapters')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('idx', '=', chapterIdx)
    .executeTakeFirst();
}

export async function getMaxChapterIdxByBookId(bookId: Chapter['bookId']) {
  const result = await getDb()
    .selectFrom('chapters')
    .select('idx')
    .where('bookId', '=', bookId)
    .orderBy('idx', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();

  return result.idx;
}

export async function getChaptersByBookId(bookId: Chapter['bookId']) {
  return getDb()
    .selectFrom('chapters')
    .selectAll()
    .where('bookId', '=', bookId)
    .orderBy('idx')
    .execute();
}

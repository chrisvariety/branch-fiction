import type { Chapter } from '@branch-fiction/extension-sdk/db';

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

export async function getChapterByBookIdAndChapterIdxs(
  bookId: Chapter['bookId'],
  chapterIdxs: Chapter['idx'][]
) {
  return getDb()
    .selectFrom('chapters')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('idx', 'in', chapterIdxs)
    .execute();
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

export async function getChapterIdsByBookId(bookId: Chapter['bookId']) {
  const results = await getDb()
    .selectFrom('chapters')
    .select('id')
    .where('bookId', '=', bookId)
    .orderBy('idx')
    .execute();

  return results.map((chapter) => chapter.id);
}

export async function getLastChapterIdByBookId(bookId: Chapter['bookId']) {
  const result = await getDb()
    .selectFrom('chapters')
    .select('id')
    .where('bookId', '=', bookId)
    .orderBy('idx', 'desc')
    .limit(1)
    .executeTakeFirst();

  return result?.id;
}

export async function getNextChapterIdByBookIdAndChapterIdx(
  bookId: Chapter['bookId'],
  chapterIdx: Chapter['idx']
) {
  const result = await getDb()
    .selectFrom('chapters')
    .select('id')
    .where('bookId', '=', bookId)
    .where('idx', '>', chapterIdx)
    .orderBy('idx')
    .limit(1)
    .executeTakeFirst();

  return result?.id;
}

import type { ChapterSceneGroup } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function getChapterSceneGroupById(id: ChapterSceneGroup['id']) {
  return getDb()
    .selectFrom('chapterSceneGroups')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getChapterSceneGroupsByBookId(bookId: ChapterSceneGroup['bookId']) {
  return getDb()
    .selectFrom('chapterSceneGroups')
    .selectAll()
    .where('bookId', '=', bookId)
    .orderBy('idx', 'asc')
    .execute();
}

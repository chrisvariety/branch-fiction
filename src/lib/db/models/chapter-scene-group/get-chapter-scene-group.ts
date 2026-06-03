import type { ChapterSceneGroup } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getChapterSceneGroupsByBookId(bookId: ChapterSceneGroup['bookId']) {
  return getDb()
    .selectFrom('chapterSceneGroups')
    .selectAll()
    .where('bookId', '=', bookId)
    .orderBy('idx', 'asc')
    .execute();
}

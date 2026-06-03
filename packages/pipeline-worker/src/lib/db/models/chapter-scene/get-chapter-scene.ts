import { jsonObjectFrom } from '@/app/lib/db/dialect';
import type { ChapterScene } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function getChapterScenesByBookId(bookId: ChapterScene['bookId']) {
  return getDb()
    .selectFrom('chapterScenes')
    .selectAll()
    .where('bookId', '=', bookId)
    .orderBy('startChapterParagraphId', 'asc')
    .execute();
}

export async function getChapterScenesByChapterId(chapterId: ChapterScene['chapterId']) {
  return getDb()
    .selectFrom('chapterScenes')
    .selectAll()
    .where('chapterId', '=', chapterId)
    .orderBy('startChapterParagraphId', 'asc')
    .execute();
}

export async function getChapterScenesWithSettingAndLocationByIds(
  ids: ChapterScene['id'][]
) {
  return getDb()
    .selectFrom('chapterScenes')
    .selectAll()
    .select((eb) => [
      jsonObjectFrom(
        eb
          .selectFrom('chapters')
          .select(['id', 'idx'])
          .whereRef('chapters.id', '=', 'chapterScenes.chapterId')
          .limit(1)
      ).as('chapter')
    ])
    .select((eb) => [
      jsonObjectFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'name'])
          .whereRef('bookEntities.id', '=', 'chapterScenes.settingBookEntityId')
          .limit(1)
      ).as('settingBookEntity')
    ])
    .select((eb) => [
      jsonObjectFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'name'])
          .whereRef('bookEntities.id', '=', 'chapterScenes.locationBookEntityId')
          .limit(1)
      ).as('locationBookEntity')
    ])
    .where('id', 'in', ids)
    .orderBy('startChapterParagraphId', 'asc')
    .execute();
}

import { sql } from 'kysely';

import type { ChapterScene, ChapterSceneUpdate, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function updateChapterSceneById(
  id: ChapterScene['id'],
  chapterScene: ChapterSceneUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('chapterScenes')
    .set({ ...chapterScene, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', id)
    .execute();
}

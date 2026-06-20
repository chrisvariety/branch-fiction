import { sql } from 'kysely';

import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export interface CharacterScene {
  title: string;
  chapterIdx: number;
  location: string | null;
  setting: string | null;
  chapterId: string;
  startChapterParagraphId: string;
  endChapterParagraphId: string;
}

// POV is matched on the denormalized povEntity name — povBookEntityId is often null in seeds.
export async function getCharacterScenes(
  bookId: string,
  characterName: string,
  trx?: Transaction
): Promise<CharacterScene[]> {
  return (trx || getDb())
    .selectFrom('chapterScenes as s')
    .innerJoin('chapters as c', 'c.id', 's.chapterId')
    .select([
      's.title',
      'c.idx as chapterIdx',
      's.location',
      's.setting',
      's.chapterId',
      's.startChapterParagraphId',
      's.endChapterParagraphId'
    ])
    .where('s.bookId', '=', bookId)
    .where(sql<boolean>`s.pov_entity LIKE ${'%' + characterName + '%'}`)
    .orderBy('c.idx', 'asc')
    .orderBy('s.startChapterParagraphId', 'asc')
    .execute();
}

export async function getSceneProse(
  scene: CharacterScene,
  maxChars: number,
  trx?: Transaction
): Promise<string> {
  const bounds = await (trx || getDb())
    .selectFrom('chapterParagraphs')
    .select(['id', 'bookParagraphIdx'])
    .where('id', 'in', [scene.startChapterParagraphId, scene.endChapterParagraphId])
    .execute();

  const indices = bounds.map((b) => b.bookParagraphIdx);
  if (indices.length === 0) return '';
  const start = Math.min(...indices);
  const end = Math.max(...indices);

  const paragraphs = await (trx || getDb())
    .selectFrom('chapterParagraphs')
    .select('content')
    .where('chapterId', '=', scene.chapterId)
    .where('bookParagraphIdx', '>=', start)
    .where('bookParagraphIdx', '<=', end)
    .orderBy('bookParagraphIdx', 'asc')
    .execute();

  return paragraphs
    .map((p) => p.content)
    .join('\n\n')
    .slice(0, maxChars);
}

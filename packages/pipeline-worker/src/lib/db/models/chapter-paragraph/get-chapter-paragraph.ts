import type { ChapterParagraph } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function getNonEmptyChapterParagraphsByChapterId(
  chapterId: ChapterParagraph['chapterId']
) {
  return getDb()
    .selectFrom('chapterParagraphs')
    .where('chapterId', '=', chapterId)
    .where('content', '!=', '')
    .select(['id', 'content', 'paragraphIdx', 'bookParagraphIdx'])
    .orderBy('paragraphIdx', 'asc')
    .execute();
}

export async function getNonEmptyChapterParagraphsByChapterIds(
  chapterIds: ChapterParagraph['chapterId'][]
) {
  return getDb()
    .selectFrom('chapterParagraphs')
    .where('chapterId', 'in', chapterIds)
    .where('content', '!=', '')
    .select(['id', 'content', 'chapterId', 'paragraphIdx', 'bookParagraphIdx'])
    .orderBy('paragraphIdx', 'asc')
    .execute();
}

export async function getNonEmptyChapterParagraphsByBookId(
  bookId: ChapterParagraph['bookId']
) {
  return getDb()
    .selectFrom('chapterParagraphs')
    .where('bookId', '=', bookId)
    .where('content', '!=', '')
    .select(['id', 'content', 'chapterIdx', 'chapterId', 'bookParagraphIdx'])
    .orderBy('bookParagraphIdx', 'asc')
    .execute();
}

export async function getNonEmptyChapterParagraphsByBookIdAndBeforeBookParagraphIdx(
  bookId: ChapterParagraph['bookId'],
  bookParagraphIdx: number,
  limit: number
) {
  const results = await getDb()
    .selectFrom('chapterParagraphs')
    .where('bookId', '=', bookId)
    .where('bookParagraphIdx', '<', bookParagraphIdx)
    .where('content', '!=', '')
    .select(['id', 'content', 'bookParagraphIdx'])
    .orderBy('bookParagraphIdx', 'desc') // desc because otherwise we'd always get the first paragraphs
    .limit(limit)
    .execute();

  // since we are sorting in descending order, we need to reverse the results to restore the original order
  return results.reverse();
}

export async function getNonEmptyChapterParagraphsByBookIdAndAfterBookParagraphIdx(
  bookId: ChapterParagraph['bookId'],
  bookParagraphIdx: number,
  limit: number
) {
  return getDb()
    .selectFrom('chapterParagraphs')
    .where('bookId', '=', bookId)
    .where('bookParagraphIdx', '>', bookParagraphIdx)
    .where('content', '!=', '')
    .select(['id', 'content', 'bookParagraphIdx'])
    .orderBy('bookParagraphIdx', 'asc')
    .limit(limit)
    .execute();
}

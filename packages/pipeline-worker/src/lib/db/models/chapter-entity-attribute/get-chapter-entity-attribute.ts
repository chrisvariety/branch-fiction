import type { ChapterEntityAttribute } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function getChapterEntityAttributesByBookEntityId(
  bookEntityId: ChapterEntityAttribute['bookEntityId']
) {
  const attributes = await getDb()
    .selectFrom('chapterEntityAttributes')
    .leftJoin('chapters', 'chapterEntityAttributes.chapterId', 'chapters.id')
    .select([
      'chapters.idx as chapterIdx',
      'chapterEntityAttributes.category',
      'chapterEntityAttributes.name',
      'chapterEntityAttributes.value',
      'chapterEntityAttributes.evidence'
    ])
    .where('chapterEntityAttributes.bookEntityId', '=', bookEntityId)
    .orderBy('chapters.idx', 'asc')
    .execute();

  return attributes.filter(hasChapterIdx);
}

export async function getChapterEntityAttributesByBookId(
  bookId: ChapterEntityAttribute['bookId']
) {
  const attributes = await getDb()
    .selectFrom('chapterEntityAttributes')
    .leftJoin('chapters', 'chapterEntityAttributes.chapterId', 'chapters.id')
    .select([
      'chapters.idx as chapterIdx',
      'chapterEntityAttributes.bookEntityId',
      'chapterEntityAttributes.category',
      'chapterEntityAttributes.name',
      'chapterEntityAttributes.value',
      'chapterEntityAttributes.evidence'
    ])
    .where('chapterEntityAttributes.bookId', '=', bookId)
    .orderBy('chapters.idx', 'asc')
    .execute();

  return attributes.filter(hasChapterIdx);
}

export async function getChapterEntityAttributesByBookEntityIds(
  bookEntityIds: ChapterEntityAttribute['bookEntityId'][]
) {
  const attributes = await getDb()
    .selectFrom('chapterEntityAttributes')
    .leftJoin('chapters', 'chapterEntityAttributes.chapterId', 'chapters.id')
    .select([
      'chapters.idx as chapterIdx',
      'chapterEntityAttributes.bookEntityId',
      'chapterEntityAttributes.category',
      'chapterEntityAttributes.name',
      'chapterEntityAttributes.value',
      'chapterEntityAttributes.evidence'
    ])
    .where('chapterEntityAttributes.bookEntityId', 'in', bookEntityIds)
    .orderBy('chapters.idx', 'asc')
    .execute();

  return attributes.filter(hasChapterIdx);
}

export async function getChapterEntityAttributesByBookEntityIdAndCategories(
  bookEntityId: ChapterEntityAttribute['bookEntityId'],
  categories: ChapterEntityAttribute['category'][]
) {
  if (categories.length === 0) return [];

  const attributes = await getDb()
    .selectFrom('chapterEntityAttributes')
    .leftJoin('chapters', 'chapterEntityAttributes.chapterId', 'chapters.id')
    .select([
      'chapters.idx as chapterIdx',
      'chapterEntityAttributes.category',
      'chapterEntityAttributes.name',
      'chapterEntityAttributes.value',
      'chapterEntityAttributes.evidence'
    ])
    .where('chapterEntityAttributes.bookEntityId', '=', bookEntityId)
    .where('chapterEntityAttributes.category', 'in', categories)
    .orderBy('chapters.idx', 'asc')
    .execute();

  return attributes.filter(hasChapterIdx);
}

export async function getChapterEntityAttributesByBookEntityIdsAndCategories(
  bookEntityIds: ChapterEntityAttribute['bookEntityId'][],
  categories: ChapterEntityAttribute['category'][]
) {
  if (bookEntityIds.length === 0) return [];
  if (categories.length === 0) return [];

  const attributes = await getDb()
    .selectFrom('chapterEntityAttributes')
    .leftJoin('chapters', 'chapterEntityAttributes.chapterId', 'chapters.id')
    .select([
      'chapters.idx as chapterIdx',
      'chapterEntityAttributes.bookEntityId',
      'chapterEntityAttributes.category',
      'chapterEntityAttributes.name',
      'chapterEntityAttributes.value',
      'chapterEntityAttributes.evidence'
    ])
    .where('chapterEntityAttributes.bookEntityId', 'in', bookEntityIds)
    .where('chapterEntityAttributes.category', 'in', categories)
    .orderBy('chapters.idx', 'asc')
    .execute();

  return attributes.filter(hasChapterIdx);
}

function hasChapterIdx<T extends { chapterIdx: unknown }>(
  item: T
): item is T & { chapterIdx: NonNullable<T['chapterIdx']> } {
  return !!item.chapterIdx;
}

function buildKeywordPatterns(keywords: string[]): RegExp[] {
  return keywords.map((k) => new RegExp(`\\b${RegExp.escape(k)}\\b`, 'i'));
}

function matchesAnyKeyword(
  patterns: RegExp[],
  fields: ReadonlyArray<string | null | undefined>
): boolean {
  return patterns.some((p) => fields.some((f) => f != null && p.test(f)));
}

export async function searchAttributesByBookEntityIdsAndKeywords(
  bookEntityIds: string[],
  keywords: string[],
  categories: ChapterEntityAttribute['category'][] = ['PHYSICAL', 'MAGICAL'],
  excludeBookEntityId?: string
) {
  if (bookEntityIds.length === 0) return [];
  if (keywords.length === 0) return [];

  const filteredIds = excludeBookEntityId
    ? bookEntityIds.filter((id) => id !== excludeBookEntityId)
    : bookEntityIds;

  if (filteredIds.length === 0) return [];

  const attributes = await getDb()
    .selectFrom('chapterEntityAttributes')
    .leftJoin('chapters', 'chapterEntityAttributes.chapterId', 'chapters.id')
    .leftJoin('bookEntities', 'chapterEntityAttributes.bookEntityId', 'bookEntities.id')
    .select([
      'chapters.idx as chapterIdx',
      'chapterEntityAttributes.bookEntityId',
      'bookEntities.name as characterName',
      'bookEntities.friendlyId as characterFriendlyId',
      'chapterEntityAttributes.category',
      'chapterEntityAttributes.name',
      'chapterEntityAttributes.value',
      'chapterEntityAttributes.evidence'
    ])
    .where('chapterEntityAttributes.bookEntityId', 'in', filteredIds)
    .where('chapterEntityAttributes.category', 'in', categories)
    .orderBy('chapters.idx', 'asc')
    .execute();

  const patterns = buildKeywordPatterns(keywords);

  return attributes
    .filter(hasChapterIdx)
    .filter((a) => matchesAnyKeyword(patterns, [a.name, a.value, a.evidence]));
}

export async function findCharacterIdsByContextKeywords(
  bookId: string,
  contextKeywords: string[],
  excludeBookEntityId?: string
) {
  if (contextKeywords.length === 0) return [];

  let query = getDb()
    .selectFrom('chapterEntityAttributes')
    .innerJoin('bookEntities', 'chapterEntityAttributes.bookEntityId', 'bookEntities.id')
    .select([
      'bookEntities.id',
      'bookEntities.name',
      'bookEntities.friendlyId',
      'chapterEntityAttributes.name as attrName',
      'chapterEntityAttributes.value',
      'chapterEntityAttributes.evidence'
    ])
    .where('bookEntities.bookId', '=', bookId)
    .where('bookEntities.type', '=', 'CHARACTER');

  if (excludeBookEntityId) {
    query = query.where('bookEntities.id', '!=', excludeBookEntityId);
  }

  const rows = await query.execute();

  const patterns = buildKeywordPatterns(contextKeywords);
  const seen = new Map<string, { id: string; name: string; friendlyId: string }>();

  for (const r of rows) {
    if (seen.has(r.id)) continue;
    if (matchesAnyKeyword(patterns, [r.attrName, r.value, r.evidence])) {
      seen.set(r.id, { id: r.id, name: r.name, friendlyId: r.friendlyId });
    }
  }

  return Array.from(seen.values());
}

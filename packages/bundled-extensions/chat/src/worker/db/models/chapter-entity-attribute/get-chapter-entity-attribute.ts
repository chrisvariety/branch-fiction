import type { ChapterEntityAttribute } from '@branch-fiction/extension-sdk/db';
import { sql } from 'kysely';

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

// this is just to make typescript happy
// (our foreign key constraints shouldn't allow for this scenario to be possible)
function hasChapterIdx<T extends { chapterIdx: unknown }>(
  item: T
): item is T & { chapterIdx: NonNullable<T['chapterIdx']> } {
  return !!item.chapterIdx;
}

// Escape special regex characters for use in PostgreSQL regex patterns
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Search attributes for specific entities using regex keyword matching with word boundaries.
 * Used by lookup_character_attribute tool to resolve comparison attributes
 * like "shorter than Killian" by finding Killian's height attributes.
 */
export async function searchAttributesByBookEntityIdsAndKeywords(
  bookEntityIds: string[],
  keywords: string[],
  categories: ChapterEntityAttribute['category'][] = ['PHYSICAL', 'MAGICAL'],
  excludeBookEntityId?: string
) {
  if (bookEntityIds.length === 0) return [];
  if (keywords.length === 0) return [];

  // Filter out excluded entity
  const filteredIds = excludeBookEntityId
    ? bookEntityIds.filter((id) => id !== excludeBookEntityId)
    : bookEntityIds;

  if (filteredIds.length === 0) return [];

  // Build OR conditions for each keyword across name, value, evidence
  // Use PostgreSQL regex with word boundaries (\y) for whole-word matching
  const keywordConditions = keywords.flatMap((keyword) => {
    const pattern = `\\y${escapeRegex(keyword)}\\y`;
    return [
      sql<boolean>`chapter_entity_attributes.name ~* ${pattern}`,
      sql<boolean>`chapter_entity_attributes.value ~* ${pattern}`,
      sql<boolean>`chapter_entity_attributes.evidence ~* ${pattern}`
    ];
  });

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
    .where((eb) => eb.or(keywordConditions))
    .orderBy('chapters.idx', 'asc')
    .execute();

  return attributes.filter(hasChapterIdx);
}

/**
 * Find distinct character IDs that have any attribute matching context keywords.
 * First step of the two-step search: find characters by context, then search their attributes.
 */
export async function findCharacterIdsByContextKeywords(
  bookId: string,
  contextKeywords: string[],
  excludeBookEntityId?: string
) {
  if (contextKeywords.length === 0) return [];

  // Build OR conditions for context keywords across all attribute fields
  // Use PostgreSQL regex with word boundaries (\y) for whole-word matching
  const contextConditions = contextKeywords.flatMap((keyword) => {
    const pattern = `\\y${escapeRegex(keyword)}\\y`;
    return [
      sql<boolean>`chapter_entity_attributes.name ~* ${pattern}`,
      sql<boolean>`chapter_entity_attributes.value ~* ${pattern}`,
      sql<boolean>`chapter_entity_attributes.evidence ~* ${pattern}`
    ];
  });

  let query = getDb()
    .selectFrom('chapterEntityAttributes')
    .innerJoin('bookEntities', 'chapterEntityAttributes.bookEntityId', 'bookEntities.id')
    .select(['bookEntities.id', 'bookEntities.name', 'bookEntities.friendlyId'])
    .distinct()
    .where('bookEntities.bookId', '=', bookId)
    .where('bookEntities.type', '=', 'CHARACTER')
    .where((eb) => eb.or(contextConditions));

  if (excludeBookEntityId) {
    query = query.where('bookEntities.id', '!=', excludeBookEntityId);
  }

  const results = await query.execute();

  return results;
}

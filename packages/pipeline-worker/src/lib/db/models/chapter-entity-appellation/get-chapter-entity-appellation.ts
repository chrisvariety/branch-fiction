import { jsonObjectFrom, parseNestedJsonFields } from '@/app/lib/db/dialect';
import { parseDbCount } from '@/app/lib/db/parse-db-count';
import { ChapterEntityAppellation } from '@/app/lib/db/types';
import { getDb } from '@/lib/db/index';

const ENTITY_JSON_SPEC = {
  sourceEntity: ['names', 'aliases'],
  targetEntity: ['names', 'aliases']
} as const;
export async function getDistinctPhraseChapterEntityAppellationsByBookId(
  bookId: ChapterEntityAppellation['bookId']
) {
  const results = await getDb()
    .selectFrom('chapterEntityAppellations')
    .select([
      'targetBookEntityId',
      'phrase',
      (eb) => eb.fn.count('phrase').as('phraseCount')
    ])
    .where('bookId', '=', bookId)
    .groupBy(['targetBookEntityId', 'phrase'])
    .execute();

  return results.map((row) => ({
    ...row,
    phraseCount: parseDbCount(row.phraseCount)
  }));
}

export async function getChapterEntityAppellationsWithChapterAndEntitiesByBookId(
  bookId: ChapterEntityAppellation['bookId']
) {
  const results = await getDb()
    .selectFrom('chapterEntityAppellations')
    .select(['id', 'phrase', 'type', 'context'])
    .select((eb) => [
      jsonObjectFrom(
        eb
          .selectFrom('chapters')
          .select(['id', 'idx'])
          .whereRef('chapters.id', '=', 'chapterEntityAppellations.chapterId')
          .limit(1)
      ).as('chapter'),
      jsonObjectFrom(
        eb
          .selectFrom('bookEntities')
          .select([
            'id',
            'type',
            'name',
            'label',
            'names',
            'aliases',
            'friendlyId',
            'minorStatus'
          ])
          .whereRef(
            'bookEntities.id',
            '=',
            'chapterEntityAppellations.sourceBookEntityId'
          )
          .limit(1)
      ).as('sourceEntity'),
      jsonObjectFrom(
        eb
          .selectFrom('bookEntities')
          .select([
            'id',
            'type',
            'name',
            'label',
            'names',
            'aliases',
            'friendlyId',
            'minorStatus'
          ])
          .whereRef(
            'bookEntities.id',
            '=',
            'chapterEntityAppellations.targetBookEntityId'
          )
          .limit(1)
      ).as('targetEntity')
    ])
    .where('bookId', '=', bookId)
    .execute();

  return results
    .map((r) => parseNestedJsonFields(ENTITY_JSON_SPEC, r))
    .filter((result) => hasChapter(result) && hasSourceAndTarget(result));
}

export async function getBookEntityIdsFromChaptersAppellations(
  chapterIds: ChapterEntityAppellation['chapterId'][],
  bookEntityIds: ChapterEntityAppellation['sourceBookEntityId'][]
) {
  if (bookEntityIds.length === 0) return [];

  const results = await getDb()
    .selectFrom('chapterEntityAppellations')
    .select(['sourceBookEntityId', 'targetBookEntityId'])
    .where('chapterId', 'in', chapterIds)
    .where((eb) =>
      eb.or([
        eb('sourceBookEntityId', 'in', bookEntityIds),
        eb('targetBookEntityId', 'in', bookEntityIds)
      ])
    )
    .execute();

  // Return all unique entity IDs that are in the input list
  const entityIdSet = new Set<string>();
  const inputIdSet = new Set(bookEntityIds);

  results.forEach((row) => {
    if (inputIdSet.has(row.sourceBookEntityId)) {
      entityIdSet.add(row.sourceBookEntityId);
    }
    if (inputIdSet.has(row.targetBookEntityId)) {
      entityIdSet.add(row.targetBookEntityId);
    }
  });

  return Array.from(entityIdSet);
}

function hasSourceAndTarget<T extends { sourceEntity: unknown; targetEntity: unknown }>(
  item: T
): item is T & {
  sourceEntity: NonNullable<T['sourceEntity']>;
  targetEntity: NonNullable<T['targetEntity']>;
} {
  return !!item.sourceEntity && !!item.targetEntity;
}

function hasChapter<T extends { chapter: unknown }>(
  item: T
): item is T & {
  chapter: NonNullable<T['chapter']>;
} {
  return !!item.chapter;
}

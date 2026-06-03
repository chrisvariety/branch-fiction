import { jsonObjectFrom, parseNestedJsonFields } from '@/app/lib/db/dialect';
import type { ChapterRelationship } from '@/app/lib/db/types';

import { getDb } from '../../index';

const ENTITY_JSON_SPEC = {
  sourceEntity: ['names', 'aliases'],
  targetEntity: ['names', 'aliases']
} as const;

export async function getChapterRelationshipsWithChapterAndEntitiesByBookId(
  bookId: ChapterRelationship['bookId']
) {
  const relationships = await getDb()
    .selectFrom('chapterRelationships')
    .select(['id', 'predicateType', 'predicateDescription'])
    .select((eb) => [
      jsonObjectFrom(
        eb
          .selectFrom('chapters')
          .select(['id', 'idx'])
          .whereRef('chapters.id', '=', 'chapterRelationships.chapterId')
          .limit(1)
      ).as('chapter'),
      jsonObjectFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'type', 'name', 'names', 'aliases', 'friendlyId', 'minorStatus'])
          .whereRef('bookEntities.id', '=', 'chapterRelationships.sourceBookEntityId')
          .limit(1)
      ).as('sourceEntity'),
      jsonObjectFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'type', 'name', 'names', 'aliases', 'friendlyId', 'minorStatus'])
          .whereRef('bookEntities.id', '=', 'chapterRelationships.targetBookEntityId')
          .limit(1)
      ).as('targetEntity')
    ])
    .where('bookId', '=', bookId)
    .execute();

  return relationships
    .map((r) => parseNestedJsonFields(ENTITY_JSON_SPEC, r))
    .filter(
      (relationship) => hasChapter(relationship) && hasSourceAndTarget(relationship)
    );
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

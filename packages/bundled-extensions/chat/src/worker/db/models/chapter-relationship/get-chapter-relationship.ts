import type { ChapterRelationship } from '@branch-fiction/extension-sdk/db';

import { jsonObjectFrom, parseNestedJsonFields } from '../../dialect';
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

export async function getChapterRelationshipsWithChapterAndEntitiesByBookIdAndHasEntityIds(
  bookId: string,
  bookEntityIds: string[]
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
          .select(['id', 'type', 'name', 'names'])
          .whereRef('bookEntities.id', '=', 'chapterRelationships.sourceBookEntityId')
          .limit(1)
      ).as('sourceEntity'),
      jsonObjectFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'type', 'name', 'names'])
          .whereRef('bookEntities.id', '=', 'chapterRelationships.targetBookEntityId')
          .limit(1)
      ).as('targetEntity')
    ])
    .where('bookId', '=', bookId)
    .where('sourceBookEntityId', 'in', bookEntityIds)
    .where('targetBookEntityId', 'in', bookEntityIds)
    // no self-relationships (e.g. Aiden->HAS_ABILITY->Aiden)
    .where(({ eb }) => eb('sourceBookEntityId', '!=', eb.ref('targetBookEntityId')))
    .execute();

  return relationships
    .map((r) => parseNestedJsonFields(ENTITY_JSON_SPEC, r))
    .filter(
      (relationship) => hasChapter(relationship) && hasSourceAndTarget(relationship)
    );
}

// this is just to make typescript happy
// (our foreign key constraints shouldn't allow for this scenario to be possible)
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

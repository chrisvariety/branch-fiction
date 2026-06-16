import { sql } from 'kysely';

import {
  BookInteractive,
  BookInteractiveEntity,
  Point,
  Transaction
} from '@/lib/db/types';

import { getDb } from '../..';
import { env } from '../../../../env/server';

export async function getBookInteractiveEntitiesByBookId(
  bookId: BookInteractiveEntity['bookId']
) {
  return getDb()
    .selectFrom('bookInteractiveEntities')
    .select([
      'id',
      'bookInteractiveId',
      'imageUrl',
      'headImageUrl',
      'croppedImageUrl',
      'segmentClass'
    ])
    .where('bookId', '=', bookId)
    .execute();
}

export async function getBookInteractiveEntitiesByInteractiveTypeAndBookIds(
  interactiveType: BookInteractive['type'],
  bookIds: BookInteractiveEntity['bookId'][],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookInteractiveEntities')
    .innerJoin(
      'bookInteractives',
      'bookInteractiveEntities.bookInteractiveId',
      'bookInteractives.id'
    )
    .select([
      'bookInteractiveEntities.bookEntityId',
      'bookInteractiveEntities.selectedBookArcId',
      'bookInteractiveEntities.croppedImageUrl'
    ])
    .where('bookInteractives.bookId', 'in', bookIds)
    .where('bookInteractives.status', '=', 'active')
    .where('bookInteractives.type', '=', interactiveType)
    .execute();
}

export async function getBookInteractiveEntityByBookIdAndBookEntityId(
  bookId: BookInteractiveEntity['bookId'],
  bookEntityId: BookInteractiveEntity['bookEntityId']
) {
  return getDb()
    .selectFrom('bookInteractiveEntities')
    .innerJoin(
      'bookInteractives',
      'bookInteractiveEntities.bookInteractiveId',
      'bookInteractives.id'
    )
    .selectAll('bookInteractiveEntities')
    .where('bookInteractives.bookId', '=', bookId)
    .where('bookInteractives.status', '=', 'active')
    .where('bookInteractiveEntities.bookEntityId', '=', bookEntityId)
    .executeTakeFirst();
}

export async function getBookInteractiveEntitiesWithEntitiesByIds(
  ids: BookInteractiveEntity['id'][]
) {
  const entities = await getDb()
    .selectFrom('bookInteractiveEntities')
    .innerJoin('bookEntities', 'bookInteractiveEntities.bookEntityId', 'bookEntities.id')
    .innerJoin(
      'bookInteractives',
      'bookInteractiveEntities.bookInteractiveId',
      'bookInteractives.id'
    )
    .select([
      'bookInteractiveEntities.id',
      'bookInteractiveEntities.bookId',
      'bookInteractiveEntities.segmentClass',
      'bookInteractiveEntities.selectedBookArcId',
      (env.DATABASE_DIALECT === 'sqlite'
        ? sql<Point[] | null>`book_interactive_entities.click_area`
        : sql<
            Point[] | null
          >`(SELECT json_agg(json_build_object('x', p[0], 'y', p[1])) FROM unnest("book_interactive_entities"."click_area") AS p)`
      ).as('clickArea'),
      'bookInteractiveEntities.imageUrl',
      'bookInteractiveEntities.croppedImageUrl',
      'bookEntities.id as bookEntityId',
      'bookEntities.name as bookEntityName',
      'bookEntities.description as bookEntityDescription',
      'bookEntities.type as bookEntityType',
      'bookInteractives.url as bookInteractiveUrl'
    ])
    .where('bookInteractiveEntities.id', 'in', ids)
    .execute();

  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));

  // sort them back into the ids order provided
  return ids.flatMap((id) => entityMap.get(id) ?? []);
}

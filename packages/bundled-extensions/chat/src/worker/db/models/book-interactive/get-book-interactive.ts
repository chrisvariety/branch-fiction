import { sql } from 'kysely';

import { BookInteractive, Point } from '@/lib/db/types';

import { getDb } from '../..';
import { env } from '../../../../env/server';
import { jsonArrayFrom, jsonObjectFrom, parseNestedJsonFields } from '../../dialect';

export async function getBookInteractivesByBookId(bookId: BookInteractive['bookId']) {
  return getDb()
    .selectFrom('bookInteractives')
    .select(['id', 'url', 'videoUrl'])
    .where('bookId', '=', bookId)
    .execute();
}

export async function getBookInteractiveById(id: BookInteractive['id']) {
  return getDb()
    .selectFrom('bookInteractives')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getBookInteractiveByIdSlim(id: BookInteractive['id']) {
  return getDb()
    .selectFrom('bookInteractives')
    .select(['id', 'type', 'url', 'videoUrl'])
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getBookInteractiveByBookIdAndTypeAndStatus(
  bookId: BookInteractive['bookId'],
  type: BookInteractive['type'],
  status: BookInteractive['status']
) {
  const result = await getDb()
    .selectFrom('bookInteractives')
    .select([
      'bookInteractives.id',
      'bookInteractives.url',
      'bookInteractives.width',
      'bookInteractives.height',
      'bookInteractives.videoUrl'
    ])
    .where('bookId', '=', bookId)
    .where('type', '=', type)
    .where('status', '=', status)
    .orderBy('createdAt', 'desc')
    .executeTakeFirst();
  return result;
}

export async function getBookInteractiveWithEntitiesByBookIdAndType(
  bookId: BookInteractive['bookId'],
  type: BookInteractive['type']
) {
  const result = await getDb()
    .selectFrom('bookInteractives')
    .select([
      'bookInteractives.id',
      'bookInteractives.url',
      'bookInteractives.width',
      'bookInteractives.height',
      'bookInteractives.videoUrl'
    ])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('bookInteractiveEntities')
          .select([
            'bookInteractiveEntities.id',
            'bookInteractiveEntities.imageUrl',
            'bookInteractiveEntities.headImageUrl',
            'bookInteractiveEntities.segmentClass',
            'bookInteractiveEntities.position',
            'bookInteractiveEntities.description',
            (env.DATABASE_DIALECT === 'sqlite'
              ? sql<Point[] | null>`book_interactive_entities.click_area`
              : sql<
                  Point[] | null
                >`(SELECT json_agg(json_build_object('x', p[0], 'y', p[1])) FROM unnest("book_interactive_entities"."click_area") AS p)`
            ).as('clickArea'),
            (env.DATABASE_DIALECT === 'sqlite'
              ? sql<Point[] | null>`book_interactive_entities.head_area`
              : sql<
                  Point[] | null
                >`(SELECT json_agg(json_build_object('x', p[0], 'y', p[1])) FROM unnest("book_interactive_entities"."head_area") AS p)`
            ).as('headArea')
          ])
          .select((ebe) =>
            jsonObjectFrom(
              ebe
                .selectFrom('bookEntities')
                .select([
                  'bookEntities.id',
                  'bookEntities.name',
                  'bookEntities.identityTag',
                  'bookEntities.pronouns',
                  'bookEntities.description',
                  'bookEntities.significanceRank'
                ])
                .whereRef('bookInteractiveEntities.bookEntityId', '=', 'bookEntities.id')
            ).as('bookEntity')
          )
          .whereRef(
            'bookInteractiveEntities.bookInteractiveId',
            '=',
            'bookInteractives.id'
          )
      ).as('bookInteractiveEntities')
    ])
    .where('bookId', '=', bookId)
    .where('type', '=', type)
    .where('status', '=', 'active')
    .executeTakeFirst();

  if (!result) return result;
  return parseNestedJsonFields(
    { bookInteractiveEntities: ['clickArea', 'headArea', 'bookEntity'] },
    result
  );
}

export async function getBookInteractiveWithEntitiesById(id: BookInteractive['id']) {
  const result = await getDb()
    .selectFrom('bookInteractives')
    .select([
      'bookInteractives.id',
      'bookInteractives.url',
      'bookInteractives.width',
      'bookInteractives.height',
      'bookInteractives.videoUrl'
    ])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('bookInteractiveEntities')
          .select([
            'bookInteractiveEntities.id',
            'bookInteractiveEntities.imageUrl',
            'bookInteractiveEntities.headImageUrl',
            'bookInteractiveEntities.segmentClass',
            'bookInteractiveEntities.position',
            'bookInteractiveEntities.description',
            (env.DATABASE_DIALECT === 'sqlite'
              ? sql<Point[] | null>`book_interactive_entities.click_area`
              : sql<
                  Point[] | null
                >`(SELECT json_agg(json_build_object('x', p[0], 'y', p[1])) FROM unnest("book_interactive_entities"."click_area") AS p)`
            ).as('clickArea'),
            (env.DATABASE_DIALECT === 'sqlite'
              ? sql<Point[] | null>`book_interactive_entities.head_area`
              : sql<
                  Point[] | null
                >`(SELECT json_agg(json_build_object('x', p[0], 'y', p[1])) FROM unnest("book_interactive_entities"."head_area") AS p)`
            ).as('headArea')
          ])
          .select((ebe) =>
            jsonObjectFrom(
              ebe
                .selectFrom('bookEntities')
                .select([
                  'bookEntities.id',
                  'bookEntities.name',
                  'bookEntities.identityTag',
                  'bookEntities.pronouns',
                  'bookEntities.description',
                  'bookEntities.significanceRank'
                ])
                .whereRef('bookInteractiveEntities.bookEntityId', '=', 'bookEntities.id')
            ).as('bookEntity')
          )
          .whereRef(
            'bookInteractiveEntities.bookInteractiveId',
            '=',
            'bookInteractives.id'
          )
      ).as('bookInteractiveEntities')
    ])
    .where('id', '=', id)
    .executeTakeFirst();

  if (!result) return result;
  return parseNestedJsonFields(
    { bookInteractiveEntities: ['clickArea', 'headArea', 'bookEntity'] },
    result
  );
}

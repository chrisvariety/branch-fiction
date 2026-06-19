import type { BookArc } from '@branch-fiction/extension-sdk/db';
import { sql } from 'kysely';

import type { Transaction } from '@/lib/db/types';

import { env } from '../../../../env/server';
import { jsonArrayFrom } from '../../dialect';
import { getDb } from '../../index';

export async function getBookArcsByBookIdAndTypesAndEntityIds(
  bookId: BookArc['bookId'],
  types: BookArc['type'][],
  entityIds: string[],
  trx?: Transaction
) {
  if (entityIds.length === 0) return [];
  return (trx || getDb())
    .selectFrom('bookArcs')
    .innerJoin('chapters as startChapter', 'startChapter.id', 'bookArcs.startChapterId')
    .innerJoin('chapters as endChapter', 'endChapter.id', 'bookArcs.endChapterId')
    .selectAll('bookArcs')
    .select(['startChapter.idx as startChapterIdx', 'endChapter.idx as endChapterIdx'])
    .where('bookArcs.bookId', '=', bookId)
    .where('bookArcs.type', 'in', types)
    .where(
      env.DATABASE_DIALECT === 'sqlite'
        ? sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value IN (${sql.join(entityIds)}))`
        : sql<boolean>`book_arcs.book_entity_ids && ARRAY[${sql.join(entityIds)}::uuid]`
    )
    .orderBy('bookArcs.friendlyIdIdx', 'asc')
    .execute();
}

// Arcs of the given types containing any of the entity ids, with the arc's entities attached.
export async function getBookArcsByBookIdAndTypesAndEntityIdsWithEntities(
  bookId: BookArc['bookId'],
  types: BookArc['type'][],
  entityIds: string[],
  trx?: Transaction
) {
  if (entityIds.length === 0) return [];
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll('bookArcs')
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'friendlyId', 'name', 'type', 'description', 'label'] as const)
          .$call((sq) =>
            env.DATABASE_DIALECT === 'sqlite'
              ? sq.where(
                  sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value = book_entities.id)`
                )
              : sq.whereRef('bookEntities.id', '=', eb.fn.any('bookArcs.bookEntityIds'))
          )
      ).as('bookEntities')
    ])
    .where('bookArcs.bookId', '=', bookId)
    .where('bookArcs.type', 'in', types)
    .where(
      env.DATABASE_DIALECT === 'sqlite'
        ? sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value IN (${sql.join(entityIds)}))`
        : sql<boolean>`book_arcs.book_entity_ids && ARRAY[${sql.join(entityIds)}::uuid]`
    )
    .orderBy('bookArcs.friendlyIdIdx', 'asc')
    .execute();
}

// Arcs where `entityId` is the FIRST entity and at least one context entity is also present.
export async function getBookArcsByBookIdAndTypesAndFirstEntityId(
  bookId: BookArc['bookId'],
  types: BookArc['type'][],
  entityId: string,
  contextEntityIds: string[],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .leftJoin('chapters as sc', 'bookArcs.startChapterId', 'sc.id')
    .leftJoin('chapters as ec', 'bookArcs.endChapterId', 'ec.id')
    .selectAll('bookArcs')
    .select(['sc.idx as startChapterIdx', 'ec.idx as endChapterIdx'])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'friendlyId', 'name', 'type', 'description', 'label'] as const)
          .$call((sq) =>
            env.DATABASE_DIALECT === 'sqlite'
              ? sq.where(
                  sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value = book_entities.id)`
                )
              : sq.whereRef('bookEntities.id', '=', eb.fn.any('bookArcs.bookEntityIds'))
          )
      ).as('bookEntities')
    ])
    .where('bookArcs.bookId', '=', bookId)
    .where('bookArcs.type', 'in', types)
    .where(
      env.DATABASE_DIALECT === 'sqlite'
        ? sql<boolean>`json_extract(book_arcs.book_entity_ids, '$[0]') = ${entityId}`
        : sql<boolean>`book_arcs.book_entity_ids[1] = ${entityId}::uuid`
    )
    .where(
      env.DATABASE_DIALECT === 'sqlite'
        ? sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value IN (${sql.join(contextEntityIds)}))`
        : sql<boolean>`book_arcs.book_entity_ids && ARRAY[${sql.join(contextEntityIds)}]::uuid[]`
    )
    .orderBy('bookArcs.friendlyIdPrefix', 'asc')
    .orderBy('bookArcs.friendlyIdIdx', 'asc')
    .execute();
}

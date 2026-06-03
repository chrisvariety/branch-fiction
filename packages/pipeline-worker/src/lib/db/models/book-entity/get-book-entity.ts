import { sql } from 'kysely';

import type { BookEntity, Transaction } from '@/app/lib/db/types';

import { normalizeName } from '../../../../lib/lit/names';
import { getDb } from '../../index';

export async function getBookEntitiesByIds(ids: BookEntity['id'][]) {
  const entities = await getDb()
    .selectFrom('bookEntities')
    .selectAll()
    .where('id', 'in', ids)
    .execute();

  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));

  // sort them back into the ids order provided
  return ids.flatMap((id) => entityMap.get(id) ?? []);
}

export async function getBookEntityNamesByIds(
  ids: BookEntity['id'][],
  trx?: Transaction
) {
  const entities = await (trx || getDb())
    .selectFrom('bookEntities')
    .select(['id', 'name'])
    .where('id', 'in', ids)
    .execute();

  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));

  // sort them back into the ids order provided
  return ids.flatMap((id) => entityMap.get(id) ?? []);
}

export async function getBookEntityNamesByBookIdsAndNotTypesAndSignificanceTiers(
  bookIds: BookEntity['bookId'][],
  types: BookEntity['type'][],
  significanceTiers: BookEntity['significanceTier'][],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookEntities')
    .select(['id', 'bookId', 'friendlyId', 'name', 'names', 'type', 'description'])
    .where('bookId', 'in', bookIds)
    .where('type', 'not in', types)
    .where('significanceTier', 'in', significanceTiers)
    .orderBy('significanceRank', 'asc')
    .execute();
}

export async function getBookEntityById(id: BookEntity['id'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('bookEntities')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst();
}

export async function getBookEntityByBookIdAndHasNames(
  bookId: BookEntity['bookId'],
  names: string[],
  trx?: Transaction
) {
  const db = trx || getDb();

  const uniqueNames = [...new Set(names)];
  let query = db
    .selectFrom('bookEntities')
    .selectAll()
    .where('bookId', '=', bookId)
    .where(sql`json_array_length(names)`, '=', uniqueNames.length);
  for (const name of uniqueNames) {
    query = query.where(
      sql<boolean>`EXISTS (SELECT 1 FROM json_each(names) WHERE value = ${name})`
    );
  }
  return query.limit(1).executeTakeFirst();
}

export async function getBookEntityByBookIdAndHasNamesCaseInsensitive(
  bookId: BookEntity['bookId'],
  names: string[],
  trx?: Transaction
) {
  const normalizedNames = names.map((n) => normalizeName(n));
  const db = trx || getDb();

  const candidates = await db
    .selectFrom('bookEntities')
    .selectAll()
    .where('bookId', '=', bookId)
    .where(sql`json_array_length(names)`, '=', names.length)
    .execute();

  const normalizedSet = new Set(normalizedNames);
  return candidates.find((entity) => {
    const storedNormalized = new Set((entity.names as string[]).map(normalizeName));
    return (
      storedNormalized.size === normalizedSet.size &&
      [...normalizedSet].every((n) => storedNormalized.has(n))
    );
  });
}

export async function getBookEntityByBookIdAndFriendlyId(
  bookId: BookEntity['bookId'],
  friendlyId: BookEntity['friendlyId'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookEntities')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('friendlyId', '=', friendlyId)
    .executeTakeFirst();
}

export async function getBookEntitiesByBookId(bookId: BookEntity['bookId']) {
  const results = await getDb()
    .selectFrom('bookEntities')
    .selectAll()
    .where('bookId', '=', bookId)
    .orderBy('name', 'asc')
    .execute();

  return results;
}

export async function getBookEntitiesByBookIdAndTypes(
  bookId: BookEntity['bookId'],
  types: BookEntity['type'][]
) {
  return getDb()
    .selectFrom('bookEntities')
    .select([
      'id',
      'label',
      'friendlyId',
      'name',
      'names',
      'type',
      'aliases',
      'pronouns',
      'continuedFromBookEntityId',
      'description',
      'hasVoice'
    ])
    .where('bookId', '=', bookId)
    .where('type', 'in', types)
    .orderBy('name', 'asc')
    .execute();
}

export async function getBookEntitiesByBookIdAndNotTypes(
  bookId: BookEntity['bookId'],
  types: BookEntity['type'][]
) {
  return getDb()
    .selectFrom('bookEntities')
    .select([
      'id',
      'friendlyId',
      'label',
      'name',
      'names',
      'type',
      'aliases',
      'pronouns',
      'continuedFromBookEntityId',
      'description',
      'hasVoice'
    ])
    .where('bookId', '=', bookId)
    .where('type', 'not in', types)
    .orderBy('name', 'asc')
    .execute();
}

export async function getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
  bookId: BookEntity['bookId'],
  types: BookEntity['type'][],
  significanceTiers: BookEntity['significanceTier'][]
) {
  return getDb()
    .selectFrom('bookEntities')
    .select([
      'id',
      'friendlyId',
      'description',
      'name',
      'names',
      'type',
      'aliases',
      'pronouns',
      'identityTag',
      'label',
      'minorStatus'
    ])
    .where('bookId', '=', bookId)
    .where('type', 'in', types)
    .where('significanceTier', 'in', significanceTiers)
    .orderBy('significanceRank', 'asc')
    .execute();
}

export async function getBookEntitiesWithSummariesByBookIdAndTypesAndSignificanceTiers(
  bookId: BookEntity['bookId'],
  types: BookEntity['type'][],
  significanceTiers: BookEntity['significanceTier'][]
) {
  return getDb()
    .selectFrom('bookEntities')
    .select([
      'id',
      'friendlyId',
      'description',
      'name',
      'names',
      'type',
      'aliases',
      'pronouns',
      'identityTag',
      'minorUntilChapterId'
    ])
    .where('bookId', '=', bookId)
    .where('type', 'in', types)
    .where('significanceTier', 'in', significanceTiers)
    .orderBy('significanceRank', 'asc')
    .execute();
}

export async function getBookEntitiesByBookIdAndSignificanceTiers(
  bookId: BookEntity['bookId'],
  significanceTiers: BookEntity['significanceTier'][]
) {
  return getDb()
    .selectFrom('bookEntities')
    .select([
      'id',
      'friendlyId',
      'label',
      'name',
      'names',
      'type',
      'aliases',
      'pronouns',
      'continuedFromBookEntityId',
      'description',
      'hasVoice'
    ])
    .where('bookId', '=', bookId)
    .where('significanceTier', 'in', significanceTiers)
    .orderBy('name', 'asc')
    .execute();
}

export async function getBookEntitiesByBookIdAndHasContinuedFromBookId(
  bookId: BookEntity['bookId']
) {
  return getDb()
    .selectFrom('bookEntities')
    .select([
      'id',
      'friendlyId',
      'label',
      'name',
      'names',
      'type',
      'aliases',
      'pronouns',
      'continuedFromBookEntityId',
      'description',
      'hasVoice'
    ])
    .where('bookId', '=', bookId)
    .where('continuedFromBookEntityId', 'is not', null)
    .orderBy('name', 'asc')
    .execute();
}

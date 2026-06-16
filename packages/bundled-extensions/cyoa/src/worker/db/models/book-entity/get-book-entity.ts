import type { BookEntity } from '@branch-fiction/extension-sdk/db';
import { sql } from 'kysely';

import type { Transaction } from '@/lib/db/types';
import { normalizeName } from '@/lib/lit/names';

import { env } from '../../../../env/server';
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

export async function getBookEntityNamesByBookIdsAndTypesAndSignificanceTiers(
  bookIds: BookEntity['bookId'][],
  types: BookEntity['type'][],
  significanceTiers: BookEntity['significanceTier'][],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookEntities')
    .select(['id', 'bookId', 'friendlyId', 'name', 'names'])
    .where('bookId', 'in', bookIds)
    .where('type', 'in', types)
    .where('significanceTier', 'in', significanceTiers)
    .orderBy('significanceRank', 'asc')
    .execute();
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

export async function getBookEntityByBookIdAndName(
  bookId: BookEntity['bookId'],
  name: BookEntity['name']
) {
  return getDb()
    .selectFrom('bookEntities')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('name', '=', name)
    .limit(1)
    .executeTakeFirst();
}

export async function getBookEntityByBookIdAndNameCaseInsensitive(
  bookId: BookEntity['bookId'],
  name: BookEntity['name']
) {
  return getDb()
    .selectFrom('bookEntities')
    .selectAll()
    .where('bookId', '=', bookId)
    .where(sql`lower(name)`, '=', name.trim().toLowerCase())
    .limit(1)
    .executeTakeFirst();
}

export async function getBookEntityByBookIdAndHasNames(
  bookId: BookEntity['bookId'],
  names: string[],
  trx?: Transaction
) {
  const db = trx || getDb();

  if (env.DATABASE_DIALECT === 'sqlite') {
    // SQLite: names stored as JSON array; check length + membership for each name
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

  const result = await sql<BookEntity>`
    select * from book_entities
    where book_id = ${bookId}
    and sort_array(names::text[]) = sort_array(${names}::text[])
    limit 1
  `.execute(db);
  return result.rows[0];
}

export async function getBookEntitiesByBookIdAndHasNames(
  bookId: BookEntity['bookId'],
  names: string[],
  trx?: Transaction
) {
  const db = trx || getDb();

  if (env.DATABASE_DIALECT === 'sqlite') {
    const uniqueNames = [...new Set(names)];
    let query = db
      .selectFrom('bookEntities')
      .select(['id', 'name', 'type'] as const)
      .where('bookId', '=', bookId)
      .where(sql`json_array_length(names)`, '=', uniqueNames.length);
    for (const name of uniqueNames) {
      query = query.where(
        sql<boolean>`EXISTS (SELECT 1 FROM json_each(names) WHERE value = ${name})`
      );
    }
    return query.execute();
  }

  const result = await sql<Pick<BookEntity, 'id' | 'name' | 'type'>>`
    select id, name, type from book_entities
    where book_id = ${bookId}
    and sort_array(names::text[]) = sort_array(${names}::text[])
  `.execute(db);
  return result.rows;
}

export async function getBookEntityByBookIdAndHasNamesCaseInsensitive(
  bookId: BookEntity['bookId'],
  names: string[],
  trx?: Transaction
) {
  const normalizedNames = names.map((n) => normalizeName(n));
  const db = trx || getDb();

  if (env.DATABASE_DIALECT === 'sqlite') {
    // SQLite lacks regexp_replace so we can't strip "the " prefix in SQL.
    // Narrow candidates by array length, then normalize stored names in JS.
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

  const result = await sql<BookEntity>`
    select * from book_entities
    where book_id = ${bookId}
    and sort_array(
      array(
        select regexp_replace(
          lower(
            replace(replace(replace(replace(n, chr(8217), ''''), chr(8216), ''''), chr(8221), '"'), chr(8220), '"')
          ),
          '^the\\\\s+', '', 'i'
        )
        from unnest(names::text[]) as n
      )
    ) = sort_array(${normalizedNames}::text[])
    limit 1
  `.execute(db);
  return result.rows[0];
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
export async function getBookEntityIdsByBookIdAndFriendlyIds(
  bookId: BookEntity['bookId'],
  friendlyIds: BookEntity['friendlyId'][],
  trx?: Transaction
) {
  const entities = await (trx || getDb())
    .selectFrom('bookEntities')
    .select(['id', 'friendlyId'])
    .where('bookId', '=', bookId)
    .where('friendlyId', 'in', friendlyIds)
    .execute();

  const entityMap = new Map(entities.map((entity) => [entity.friendlyId, entity]));

  // sort them back into the friendlyIds order provided
  return friendlyIds.flatMap((friendlyId) => entityMap.get(friendlyId) ?? []);
}

export async function getBookEntitiesByBookIdsAndFriendlyIds(
  bookIds: BookEntity['bookId'][],
  friendlyIds: BookEntity['friendlyId'][],
  trx?: Transaction
) {
  if (friendlyIds.length === 0) return [];
  return (trx || getDb())
    .selectFrom('bookEntities')
    .select(['id', 'friendlyId', 'bookId'])
    .where('bookId', 'in', bookIds)
    .where('friendlyId', 'in', friendlyIds)
    .execute();
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

export async function getBookEntitiesByBookIds(bookIds: BookEntity['bookId'][]) {
  return getDb()
    .selectFrom('bookEntities')
    .selectAll()
    .where('bookId', 'in', bookIds)
    .orderBy('name', 'asc')
    .execute();
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

export async function getBookEntitiesByBookIdAndTypesAndHasVoice(
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
      'description'
    ])
    .where('bookId', '=', bookId)
    .where('type', 'in', types)
    .where('hasVoice', '=', true)
    .orderBy('significanceRank', 'asc')
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
      'label'
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

// WITH opposite_entities AS (
//   -- Step 1: Find all relationships and identify the "opposite" entity ID
//   SELECT
//     CASE
//       WHEN source_book_entity_id = '0199a666-f098-7469-ba91-9252826f72b2'::uuid
//       THEN target_book_entity_id
//       ELSE source_book_entity_id
//     END AS opposite_entity_id
//   FROM
//     chapter_relationships
//   WHERE
//     source_book_entity_id = '0199a666-f098-7469-ba91-9252826f72b2'::uuid
//     OR target_book_entity_id = '0199a666-f098-7469-ba91-9252826f72b2'::uuid
// )
// -- Step 2 & 3: Join the opposite entities with their attributes and names, then filter
// SELECT DISTINCT
//   be.name
// FROM
//   opposite_entities AS oe
// JOIN
//   chapter_entity_attributes AS cea
//   ON oe.opposite_entity_id = cea.book_entity_id
// JOIN
//   book_entities AS be
//   ON oe.opposite_entity_id = be.id
// WHERE
//   cea.category IN ('PHYSICAL', 'MAGICAL');
export async function getRelatedEntitiesWithAttributesById(
  bookEntityId: string,
  onlyCategories?: string[]
) {
  const relatedEntities = await getDb()
    // 1. Create a CTE named `oppositeEntities`
    .with('oppositeEntities', (db) =>
      db
        .selectFrom('chapterRelationships')
        // 2. Use a CASE statement to find the "opposite" entity ID
        .select((eb) => [
          eb
            .case()
            .when('sourceBookEntityId', '=', bookEntityId)
            .then(eb.ref('targetBookEntityId'))
            .else(eb.ref('sourceBookEntityId'))
            .end()
            .as('oppositeEntityId')
        ])
        // 3. Filter for relationships involving the given entity
        .where((eb) =>
          eb.or([
            eb('sourceBookEntityId', '=', bookEntityId),
            eb('targetBookEntityId', '=', bookEntityId)
          ])
        )
    )
    // 4. Query from the CTE
    .selectFrom('oppositeEntities as oe')
    // 5. Join to ensure the entity has at least one attribute
    .innerJoin(
      'chapterEntityAttributes as cea',
      'oe.oppositeEntityId',
      'cea.bookEntityId'
    )
    // 6. Join to get the entity's name and id
    .innerJoin('bookEntities as be', 'oe.oppositeEntityId', 'be.id')
    // 7. Select the unique name, id, friendlyId, and description
    .select(['be.id', 'be.name', 'be.friendlyId', 'be.description'])
    .distinct()
    .$if(!!onlyCategories?.length, (qb) =>
      qb.where('cea.category', 'in', onlyCategories!)
    )
    .execute();

  return relatedEntities;
}

export async function getBookEntityIdsWithoutRelationshipsAndAttributesByBookId(
  bookId: BookEntity['bookId']
) {
  const results = await getDb()
    .selectFrom('bookEntities as be')
    .leftJoin('chapterRelationships as cr', (join) =>
      join.on((eb) =>
        eb.or([
          eb('be.id', '=', eb.ref('cr.sourceBookEntityId')),
          eb('be.id', '=', eb.ref('cr.targetBookEntityId'))
        ])
      )
    )
    .leftJoin('chapterEntityAttributes as cea', 'be.id', 'cea.bookEntityId')
    .select('be.id')
    .where('be.bookId', '=', bookId)
    .groupBy('be.id')
    .having((eb) => eb.fn.count('cr.id').distinct(), '=', 0)
    .having((eb) => eb.fn.count('cea.id').distinct(), '=', 0)
    .execute();

  return results.map((r) => r.id);
}

// Sort first by PRIMARY entities (by significanceRank ASC), then SECONDARY entities (by significanceRank ASC)
export function sortBySignificanceTierAndRank<
  T extends {
    significanceTier: BookEntity['significanceTier'];
    significanceRank: BookEntity['significanceRank'];
  }
>(entities: T[]): T[] {
  return entities.sort((a, b) => {
    // PRIMARY entities come first
    if (a.significanceTier === 'PRIMARY' && b.significanceTier !== 'PRIMARY') {
      return -1;
    }
    if (a.significanceTier !== 'PRIMARY' && b.significanceTier === 'PRIMARY') {
      return 1;
    }

    // SECONDARY entities come second
    if (a.significanceTier === 'SECONDARY' && b.significanceTier !== 'SECONDARY') {
      return -1;
    }
    if (a.significanceTier !== 'SECONDARY' && b.significanceTier === 'SECONDARY') {
      return 1;
    }

    // null entities come third
    if (a.significanceTier === null && b.significanceTier !== null) {
      return -1;
    }
    if (a.significanceTier !== null && b.significanceTier === null) {
      return 1;
    }

    // Within the same tier, sort by significanceRank ascending
    return (a.significanceRank ?? Infinity) - (b.significanceRank ?? Infinity);
  });
}

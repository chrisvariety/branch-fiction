import { sql } from 'kysely';

import { Transaction, UserWorld } from '@/lib/db/types';

import { getDb } from '../..';
import { env } from '../../../../env/server';
import { jsonArrayFrom, parseNestedJsonFields } from '../../dialect';

export async function getUserWorldWithEntitiesById(
  id: UserWorld['id'],
  trx?: Transaction
) {
  const result = await (trx || getDb())
    .selectFrom('userWorlds')
    .selectAll()
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('bookInteractiveEntities')
          .innerJoin(
            'bookEntities',
            'bookInteractiveEntities.bookEntityId',
            'bookEntities.id'
          )
          .innerJoin(
            'bookInteractives',
            'bookInteractiveEntities.bookInteractiveId',
            'bookInteractives.id'
          )
          .leftJoin(
            'bookArcs',
            'bookInteractiveEntities.selectedBookArcId',
            'bookArcs.id'
          )
          .select([
            'bookInteractiveEntities.id',
            'bookInteractiveEntities.bookId',
            'bookInteractiveEntities.croppedImageUrl',
            'bookEntities.id as bookEntityId',
            'bookEntities.name as bookEntityName',
            'bookEntities.type as bookEntityType',
            'bookInteractives.url as bookInteractiveUrl',
            'bookArcs.content as bookArcContent'
          ])
          .$call((qb) =>
            env.DATABASE_DIALECT === 'sqlite'
              ? qb.where(
                  sql<boolean>`EXISTS (SELECT 1 FROM json_each(user_worlds.book_interactive_entity_ids) WHERE value = book_interactive_entities.id)`
                )
              : qb.whereRef(
                  'bookInteractiveEntities.id',
                  '=',
                  eb.fn.any('userWorlds.bookInteractiveEntityIds')
                )
          )
      ).as('bookInteractiveEntities'),
      jsonArrayFrom(
        eb
          .selectFrom('books')
          .leftJoin('bookSettings', 'bookSettings.bookId', 'books.id')
          .select(['books.id', 'bookSettings.artStyle', 'books.title'])
          .$call((qb) =>
            env.DATABASE_DIALECT === 'sqlite'
              ? qb.where(
                  sql<boolean>`EXISTS (SELECT 1 FROM json_each(user_worlds.book_ids) WHERE value = books.id)`
                )
              : qb.whereRef('books.id', '=', eb.fn.any('userWorlds.bookIds'))
          )
      ).as('books')
    ])
    .where('id', '=', id)
    .executeTakeFirst();

  if (!result) return result;

  // Sort bookInteractiveEntities back into the stored bookInteractiveEntityIds order
  // (the first character is the player character, so ordering matters)
  const entityMap = new Map(
    result.bookInteractiveEntities.map((entity) => [entity.id, entity])
  );
  result.bookInteractiveEntities = result.bookInteractiveEntityIds.flatMap(
    (id) => entityMap.get(id) ?? []
  );

  return result;
}

export async function getAllUserWorldImageUrls() {
  return getDb()
    .selectFrom('userWorlds')
    .select(['imageUrl'])
    .where('imageUrl', 'is not', null)
    .execute();
}

export async function getUserWorldsByUserId(
  userId: UserWorld['userId'],
  limit?: number,
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('userWorlds')
    .select(['id', 'title', 'slug', 'imageUrl'])
    .where('userId', '=', userId)
    .orderBy('updatedAt', 'desc')
    .$if(limit !== null, (qb) => qb.limit(limit!))
    .execute();
}

/**
 * Find all userWorlds with the exact same set of bookInteractiveEntityIds
 * (regardless of order) that have scenarios. Returns the aggregated
 * scenario IDs and the first available imageUrl.
 */
export async function findExistingWorldDataByExactEntityIds(
  bookInteractiveEntityIds: string[]
) {
  const matching = await getDb()
    .selectFrom('userWorlds')
    .select(['imageUrl', 'scenarioIds'])
    .where('imageUrl', 'is not', null)
    // Same set: mutual containment + same length
    .where(
      env.DATABASE_DIALECT === 'sqlite'
        ? sql<boolean>`(SELECT COUNT(*) FROM json_each(book_interactive_entity_ids) WHERE value IN (${sql.join(bookInteractiveEntityIds)})) = ${bookInteractiveEntityIds.length}`
        : sql<boolean>`book_interactive_entity_ids @> ARRAY[${sql.join(bookInteractiveEntityIds)}]::uuid[]`
    )
    .where(
      env.DATABASE_DIALECT === 'sqlite'
        ? sql<boolean>`NOT EXISTS (SELECT 1 FROM json_each(book_interactive_entity_ids) WHERE value NOT IN (${sql.join(bookInteractiveEntityIds)}))`
        : sql<boolean>`book_interactive_entity_ids <@ ARRAY[${sql.join(bookInteractiveEntityIds)}]::uuid[]`
    )
    // First element (1-indexed) (player character) must match
    .where(
      env.DATABASE_DIALECT === 'sqlite'
        ? sql<boolean>`json_extract(book_interactive_entity_ids, '$[0]') = ${bookInteractiveEntityIds[0]}`
        : sql<boolean>`book_interactive_entity_ids[1] = ${bookInteractiveEntityIds[0]}::uuid`
    )
    .execute();

  if (matching.length === 0) return null;

  const imageUrls = [
    ...new Set(matching.map((c) => c.imageUrl).filter(Boolean))
  ] as string[];
  const scenarioIds = [...new Set(matching.flatMap((c) => c.scenarioIds))];

  return { imageUrls, scenarioIds };
}

export async function getUserWorldByUserIdAndSlug(
  userId: UserWorld['userId'],
  slug: UserWorld['slug'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('userWorlds')
    .selectAll()
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

export async function getUserWorldWithScenariosByUserIdAndSlug(
  userId: UserWorld['userId'],
  slug: UserWorld['slug'],
  trx?: Transaction
) {
  const result = await (trx || getDb())
    .selectFrom('userWorlds')
    .selectAll()
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('scenarios')
          .select([
            'scenarios.id',
            'scenarios.title',
            'scenarios.toneTags',
            'scenarios.description'
          ])
          .$call((qb) =>
            env.DATABASE_DIALECT === 'sqlite'
              ? qb.where(
                  sql<boolean>`EXISTS (SELECT 1 FROM json_each(user_worlds.scenario_ids) WHERE value = scenarios.id)`
                )
              : qb.whereRef('scenarios.id', '=', eb.fn.any('userWorlds.scenarioIds'))
          )
      ).as('scenarios'),
      jsonArrayFrom(
        eb
          .selectFrom('bookInteractiveEntities')
          .innerJoin(
            'bookEntities',
            'bookEntities.id',
            'bookInteractiveEntities.bookEntityId'
          )
          .select([
            'bookInteractiveEntities.id',
            'bookEntities.name',
            'bookInteractiveEntities.headImageUrl'
          ])
          .$call((qb) =>
            env.DATABASE_DIALECT === 'sqlite'
              ? qb.where(
                  sql<boolean>`EXISTS (SELECT 1 FROM json_each(user_worlds.book_interactive_entity_ids) WHERE value = book_interactive_entities.id)`
                )
              : qb.whereRef(
                  'bookInteractiveEntities.id',
                  '=',
                  eb.fn.any('userWorlds.bookInteractiveEntityIds')
                )
          )
      ).as('entities')
    ])
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();

  if (!result) return result;

  return parseNestedJsonFields({ scenarios: ['toneTags'] }, result);
}

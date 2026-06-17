import type { BookArc } from '@branch-fiction/extension-sdk/db';
import { parseDbCount } from '@branch-fiction/extension-sdk/db/parse-count';
import { sql } from 'kysely';

import type { Transaction } from '@/lib/db/types';
import type { ArcType } from '@/lib/lit/arc-types';
import { getArcTypePrefix } from '@/lib/lit/arc-types';
import { generateUniqueFriendlyPrefix } from '@/lib/lit/friendly-id';

import { env } from '../../../../env/server';
import { jsonArrayFrom } from '../../dialect';
import { getDb } from '../../index';
import { getBookEntityNamesByIds } from '../book-entity/get-book-entity';

export async function getBookArcById(id: BookArc['id'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst();
}

export async function getBookArcsByIds(ids: BookArc['id'][], trx?: Transaction) {
  const arcs = await (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .where('id', 'in', ids)
    .execute();

  const arcMap = new Map(arcs.map((arc) => [arc.id, arc]));

  // sort them back into the ids order provided
  return ids.flatMap((id) => arcMap.get(id) ?? []);
}

export async function getBookArcWithChaptersById(id: BookArc['id'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .leftJoin('chapters as sc', 'bookArcs.startChapterId', 'sc.id')
    .leftJoin('chapters as ec', 'bookArcs.endChapterId', 'ec.id')
    .selectAll('bookArcs')
    .select(['sc.idx as startChapterIdx', 'ec.idx as endChapterIdx'])
    .where('bookArcs.id', '=', id)
    .limit(1)
    .executeTakeFirst();
}

export async function getBookArcsByBookId(bookId: BookArc['bookId'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .where('bookId', '=', bookId)
    .orderBy('friendlyIdIdx', 'asc')
    .execute();
}

export async function getBookArcsByBookIdAndType(
  bookId: BookArc['bookId'],
  type: BookArc['type'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('type', '=', type)
    .orderBy('friendlyIdIdx', 'asc')
    .execute();
}

export async function getBookArcsIdsByBookIdAndFriendlyIds(
  bookId: BookArc['bookId'],
  friendlyIds: BookArc['friendlyId'][],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .select(['id', 'friendlyId'])
    .where('bookId', '=', bookId)
    .where('friendlyId', 'in', friendlyIds)
    .orderBy('friendlyIdIdx', 'asc')
    .execute();
}

export async function getBookArcsByBookIdAndTypes(
  bookId: BookArc['bookId'],
  types: BookArc['type'][],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('type', 'in', types)
    .orderBy('type', 'asc')
    .orderBy('friendlyIdIdx', 'asc')
    .execute();
}

export async function getBookArcsByBookIdAndTypeAndFriendlyIdPrefix(
  bookId: BookArc['bookId'],
  type: BookArc['type'],
  friendlyIdPrefix: BookArc['friendlyIdPrefix'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('type', '=', type)
    .where('friendlyIdPrefix', '=', friendlyIdPrefix)
    .orderBy('friendlyIdIdx', 'asc')
    .execute();
}

export async function getBookArcsWithEntitiesByBookIdAndType(
  bookId: BookArc['bookId'],
  type: BookArc['type'],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'friendlyId', 'name', 'type', 'description', 'label'] as const)
          .$call((qb) =>
            env.DATABASE_DIALECT === 'sqlite'
              ? qb.where(
                  sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value = book_entities.id)`
                )
              : qb.whereRef('bookEntities.id', '=', eb.fn.any('bookArcs.bookEntityIds'))
          )
      ).as('bookEntities')
    ])
    .where('bookId', '=', bookId)
    .where('type', '=', type)
    .orderBy('friendlyIdIdx', 'asc')
    .execute();
}
export async function getBookArcsByBookIdAndTypesAndEntityIds(
  bookId: BookArc['bookId'],
  types: BookArc['type'][],
  entityIds: string[],
  options?: {
    includeChapters?: boolean;
    includeEntities?: boolean;
  },
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .$if(!!options?.includeChapters, (qb) =>
      qb
        .leftJoin('chapters as sc', 'bookArcs.startChapterId', 'sc.id')
        .leftJoin('chapters as ec', 'bookArcs.endChapterId', 'ec.id')
        .selectAll('bookArcs')
        .select(['sc.idx as startChapterIdx', 'ec.idx as endChapterIdx'])
    )
    .$if(!!options?.includeEntities, (qb) =>
      qb.select((eb) => [
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
    )
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

/**
 * Get arcs where the given entity is the FIRST entity in the bookEntityIds array,
 * AND the arc also contains at least one of the context entity IDs.
 *
 * This is useful for RELATED_RELATIONSHIP arcs where the first entity is the "subject"
 * of the relationship (e.g., the item/object being described), and we want to filter
 * to only arcs that are relevant to a specific context (e.g., a character).
 */
export async function getBookArcsByBookIdAndTypesAndFirstEntityId(
  bookId: BookArc['bookId'],
  types: BookArc['type'][],
  entityId: string,
  contextEntityIds: string[],
  options?: {
    includeChapters?: boolean;
    includeEntities?: boolean;
  },
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .selectAll()
    .$if(!!options?.includeChapters, (qb) =>
      qb
        .leftJoin('chapters as sc', 'bookArcs.startChapterId', 'sc.id')
        .leftJoin('chapters as ec', 'bookArcs.endChapterId', 'ec.id')
        .selectAll('bookArcs')
        .select(['sc.idx as startChapterIdx', 'ec.idx as endChapterIdx'])
    )
    .$if(!!options?.includeEntities, (qb) =>
      qb.select((eb) => [
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
    )
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

/**
 * Get relationship arcs with chapter information that either:
 * 1. Contain all selected entities, OR
 * 2. Are a subset of selected entities (all arc entities are in the selected list)
 */
export async function getRelationshipBookArcsByBookIdAndContainingEntityIds(
  bookId: BookArc['bookId'],
  entityIds: string[],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs as a')
    .leftJoin('chapters as sc', 'a.startChapterId', 'sc.id')
    .leftJoin('chapters as ec', 'a.endChapterId', 'ec.id')
    .selectAll('a')
    .select(['sc.idx as startChapterIdx', 'ec.idx as endChapterIdx'])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'friendlyId', 'name', 'type', 'description', 'label'] as const)
          .$call((sq) =>
            env.DATABASE_DIALECT === 'sqlite'
              ? sq.where(
                  sql<boolean>`EXISTS (SELECT 1 FROM json_each(a.book_entity_ids) WHERE value = book_entities.id)`
                )
              : sq.whereRef('bookEntities.id', '=', eb.fn.any('a.bookEntityIds'))
          )
      ).as('bookEntities')
    ])
    .where('a.bookId', '=', bookId)
    .where('a.type', 'in', ['RELATIONSHIP', 'RELATIONSHIP_ISOLATED'])
    .where((eb) =>
      eb.or([
        // Arc contains all selected entities (@> superset)
        env.DATABASE_DIALECT === 'sqlite'
          ? sql<boolean>`(SELECT COUNT(*) FROM json_each(a.book_entity_ids) WHERE value IN (${sql.join(entityIds)})) = ${entityIds.length}`
          : sql<boolean>`a.book_entity_ids @> ARRAY[${sql.join(entityIds)}]::uuid[]`,
        // Arc is a subset of selected entities (<@ subset)
        env.DATABASE_DIALECT === 'sqlite'
          ? sql<boolean>`NOT EXISTS (SELECT 1 FROM json_each(a.book_entity_ids) WHERE value NOT IN (${sql.join(entityIds)}))`
          : sql<boolean>`a.book_entity_ids <@ ARRAY[${sql.join(entityIds)}]::uuid[]`
      ])
    )
    .orderBy('a.friendlyIdIdx', 'asc')
    .execute();
}

/**
 * Get other entity IDs that appear in the same book arcs as the given entity,
 * along with a count of how many arcs they share.
 *
 * @param bookId - The book ID to filter by
 * @param type - The arc type to filter by
 * @param entityId - The entity ID to find related entities for
 * @param trx - Optional transaction
 * @returns Array of objects with bookEntityId and count of shared arcs
 */
export async function getRelatedBookEntityIdsByEntityId(
  bookId: string,
  type: BookArc['type'],
  entityId: string,
  trx?: Transaction
): Promise<Array<{ bookEntityId: string; count: number }>> {
  const db = trx || getDb();

  const query =
    env.DATABASE_DIALECT === 'sqlite'
      ? sql<{ bookEntityId: string; count: string }>`
          SELECT
            je.value AS "bookEntityId",
            COUNT(*) AS count
          FROM book_arcs ba
          JOIN json_each(ba.book_entity_ids) AS je
          WHERE ba.book_id = ${bookId}
            AND ba.type = ${type}
            AND EXISTS (SELECT 1 FROM json_each(ba.book_entity_ids) WHERE value = ${entityId})
            AND je.value != ${entityId}
          GROUP BY je.value
        `
      : sql<{ bookEntityId: string; count: string }>`
          SELECT
            other_entity_id AS "bookEntityId",
            COUNT(*) AS count
          FROM book_arcs ba
          CROSS JOIN LATERAL unnest(ba.book_entity_ids) AS other_entity_id
          WHERE ba.book_id = ${bookId}
            AND ba.type = ${type}
            AND ${entityId}::uuid = ANY(ba.book_entity_ids)
            AND other_entity_id != ${entityId}::uuid
          GROUP BY other_entity_id
        `;

  const result = await query.execute(db);
  return result.rows.map((r) => ({
    bookEntityId: r.bookEntityId,
    count: parseDbCount(r.count)
  }));
}

/**
 * Generate a unique friendly prefix for a set of entities in a book arc,
 * handling collisions by progressively expanding initials.
 *
 * @returns The friendly ID prefix (e.g., "R-VXD-")
 */
export async function generateUniqueArcFriendlyPrefix({
  bookId,
  arcType,
  entityIds,
  trx
}: {
  bookId: string;
  arcType: ArcType;
  entityIds: string[];
  trx?: Transaction;
}): Promise<string> {
  const db = trx || getDb();

  const entities = await getBookEntityNamesByIds(entityIds, trx);
  const typePrefix = getArcTypePrefix(arcType);
  const sortedEntityIds = [...entityIds].sort();

  const checkCollision = async (prefix: string): Promise<boolean> => {
    const existingArcs = await db
      .selectFrom('bookArcs')
      .select(['id as arcId', 'bookEntityIds'])
      .where('bookId', '=', bookId)
      .where('friendlyIdPrefix', '=', prefix)
      .execute();

    // Check if any existing arc has a different entity set
    for (const arc of existingArcs) {
      const sortedExisting = [...arc.bookEntityIds].sort();
      // If entity sets are different, we have a collision
      if (JSON.stringify(sortedEntityIds) !== JSON.stringify(sortedExisting)) {
        return true;
      }
    }

    return false;
  };

  return generateUniqueFriendlyPrefix({
    typePrefix,
    entities,
    checkCollision
  });
}

export async function getEntitiesWithAppearanceArcByBookIds(
  bookIds: BookArc['bookId'][],
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('bookArcs')
    .innerJoin('bookEntities', (join) =>
      join.on(
        env.DATABASE_DIALECT === 'sqlite'
          ? sql<boolean>`book_entities.id = json_extract(book_arcs.book_entity_ids, '$[0]')`
          : sql<boolean>`book_entities.id = book_arcs.book_entity_ids[1]`
      )
    )
    .select([
      'bookEntities.id',
      'bookEntities.bookId',
      'bookEntities.name',
      'bookEntities.names',
      'bookEntities.type',
      'bookEntities.friendlyId'
    ])
    .where('bookArcs.bookId', 'in', bookIds)
    .where('bookArcs.type', '=', 'APPEARANCE')
    .distinct()
    .execute();
}

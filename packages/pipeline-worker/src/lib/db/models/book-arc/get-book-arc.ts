import { sql } from 'kysely';

import { jsonArrayFrom } from '@/app/lib/db/dialect';
import type { BookArc, Transaction } from '@/app/lib/db/types';

import type { ArcType } from '../../../../lib/lit/arc-types';
import { getArcTypePrefix } from '../../../../lib/lit/arc-types';
import { generateUniqueFriendlyPrefix } from '../../../../lib/lit/friendly-id';
import { getDb } from '../../index';
import { getBookEntityNamesByIds } from '../book-entity/get-book-entity';

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
          .where(
            sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value = book_entities.id)`
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
            .where(
              sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value = book_entities.id)`
            )
        ).as('bookEntities')
      ])
    )
    .where('bookArcs.bookId', '=', bookId)
    .where('bookArcs.type', 'in', types)
    .where(
      sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value IN (${sql.join(entityIds)}))`
    )
    .orderBy('bookArcs.friendlyIdIdx', 'asc')
    .execute();
}

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
            .where(
              sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value = book_entities.id)`
            )
        ).as('bookEntities')
      ])
    )
    .where('bookArcs.bookId', '=', bookId)
    .where('bookArcs.type', 'in', types)
    .where(sql<boolean>`json_extract(book_arcs.book_entity_ids, '$[0]') = ${entityId}`)
    .where(
      sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value IN (${sql.join(contextEntityIds)}))`
    )
    .orderBy('bookArcs.friendlyIdPrefix', 'asc')
    .orderBy('bookArcs.friendlyIdIdx', 'asc')
    .execute();
}

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

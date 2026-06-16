import type { BookArc } from '@branch-fiction/extension-sdk/db';
import { sql } from 'kysely';

import type { Transaction } from '@/lib/db/types';

import { env } from '../../../../env/server';
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
    .selectAll()
    .where('bookId', '=', bookId)
    .where('type', 'in', types)
    .where(
      env.DATABASE_DIALECT === 'sqlite'
        ? sql<boolean>`EXISTS (SELECT 1 FROM json_each(book_arcs.book_entity_ids) WHERE value IN (${sql.join(entityIds)}))`
        : sql<boolean>`book_arcs.book_entity_ids && ARRAY[${sql.join(entityIds)}::uuid]`
    )
    .orderBy('friendlyIdIdx', 'asc')
    .execute();
}

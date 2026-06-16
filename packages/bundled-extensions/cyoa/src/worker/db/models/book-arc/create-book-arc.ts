import type { NewBookArc } from '@branch-fiction/extension-sdk/db';
import { sql } from 'kysely';

import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createBookArcs(
  bookArcs: Omit<NewBookArc, 'friendlyId' | 'friendlyIdPrefix' | 'friendlyIdIdx'>[],
  friendlyIdPrefix: string,
  trx?: Transaction
) {
  const db = trx || getDb();

  const bookId = bookArcs[0]?.bookId;
  const maxResult = await db
    .selectFrom('bookArcs')
    .select(sql<number>`MAX(friendly_id_idx)`.as('maxIndex'))
    .where('friendlyIdPrefix', '=', friendlyIdPrefix)
    .where('bookId', '=', bookId)
    .executeTakeFirst();

  let nextIndex = (maxResult?.maxIndex || 0) + 1;

  return db
    .insertInto('bookArcs')
    .values(
      bookArcs.map((bookArc) => ({
        ...bookArc,
        friendlyIdPrefix,
        friendlyIdIdx: nextIndex++
      }))
    )
    .returningAll()
    .execute();
}

export async function createRawBookArc(bookArc: NewBookArc, trx?: Transaction) {
  const db = trx || getDb();

  return db.insertInto('bookArcs').values(bookArc).returningAll().executeTakeFirst();
}

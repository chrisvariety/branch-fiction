import { sql } from 'kysely';

import type { NewScenario, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createScenario(
  scenario: Omit<NewScenario, 'friendlyId' | 'friendlyIdPrefix' | 'friendlyIdIdx'>,
  friendlyIdPrefix: string,
  trx?: Transaction
) {
  const db = trx || getDb();

  // Get max friendly_id_idx for this prefix and bookId
  const maxResult = await db
    .selectFrom('scenarios')
    .select(sql<number>`MAX(friendly_id_idx)`.as('maxIndex'))
    .where('friendlyIdPrefix', '=', friendlyIdPrefix)
    .where('bookId', '=', scenario.bookId)
    .executeTakeFirst();

  const nextIndex = (maxResult?.maxIndex || 0) + 1;

  return db
    .insertInto('scenarios')
    .values({
      ...scenario,
      friendlyIdPrefix,
      friendlyIdIdx: nextIndex
    })
    .returning(['id', 'friendlyId', 'title', 'description'])
    .executeTakeFirst();
}

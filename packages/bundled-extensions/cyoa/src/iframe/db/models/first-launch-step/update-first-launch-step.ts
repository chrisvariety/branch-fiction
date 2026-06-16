import { sql } from 'kysely';

import { getDb } from '@/iframe/db';
import type { FirstLaunchStep } from '@/lib/db/types';

export async function resetErroredFirstLaunchSteps(
  bookId: FirstLaunchStep['bookId']
): Promise<void> {
  await getDb()
    .updateTable('firstLaunchSteps')
    .set({
      startedAt: null,
      completedAt: null,
      lastError: null,
      updatedAt: sql`datetime('now')`
    })
    .where('bookId', '=', bookId)
    .where('lastError', 'is not', null)
    .execute();
}

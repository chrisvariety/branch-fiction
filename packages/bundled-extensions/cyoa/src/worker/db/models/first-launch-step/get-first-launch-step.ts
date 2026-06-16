import type { FirstLaunchStep, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getFirstLaunchStepsByBookId(
  bookId: FirstLaunchStep['bookId'],
  trx?: Transaction
): Promise<FirstLaunchStep[]> {
  return (trx || getDb())
    .selectFrom('firstLaunchSteps')
    .selectAll()
    .where('bookId', '=', bookId)
    .execute();
}

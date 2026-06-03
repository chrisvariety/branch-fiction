import type { FirstLaunchStep, NewFirstLaunchStep, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createFirstLaunchSteps(
  steps: NewFirstLaunchStep[],
  trx?: Transaction
): Promise<FirstLaunchStep[]> {
  if (steps.length === 0) return [];
  return (trx || getDb())
    .insertInto('firstLaunchSteps')
    .values(steps)
    .returningAll()
    .execute();
}

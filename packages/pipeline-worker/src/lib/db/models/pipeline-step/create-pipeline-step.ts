import type { NewPipelineStep, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createPipelineSteps(steps: NewPipelineStep[], trx?: Transaction) {
  if (steps.length === 0) return [];
  return (trx || getDb())
    .insertInto('pipelineSteps')
    .values(steps)
    .returningAll()
    .execute();
}

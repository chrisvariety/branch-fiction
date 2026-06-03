import type { NewPipelineStepUsage, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createPipelineStepUsage(
  usage: NewPipelineStepUsage,
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('pipelineStepUsages')
    .values(usage)
    .returningAll()
    .executeTakeFirst();
}

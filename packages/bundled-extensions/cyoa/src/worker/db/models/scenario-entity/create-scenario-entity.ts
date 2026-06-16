import type { NewScenarioEntity, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createScenarioEntities(
  scenarioEntities: NewScenarioEntity[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('scenarioEntities')
    .values(scenarioEntities)
    .returning(['id'])
    .execute();
}

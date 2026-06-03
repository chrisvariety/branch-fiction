import type { NewProviderModel, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createProviderModel(
  providerModel: NewProviderModel,
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('providerModels')
    .values(providerModel)
    .returningAll()
    .executeTakeFirst();
}

export async function upsertProviderModel(
  providerModel: NewProviderModel & { providerId: string; modelKey: string },
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('providerModels')
    .values(providerModel)
    .onConflict((oc) =>
      oc.columns(['providerId', 'modelKey']).doUpdateSet({
        displayName: providerModel.displayName ?? null,
        config: providerModel.config ?? null,
        reasoning: providerModel.reasoning ?? null
      })
    )
    .returningAll()
    .executeTakeFirst();
}

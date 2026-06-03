import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getProviderModelByProviderAndKey(
  providerId: string,
  modelKey: string,
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('providerModels')
    .selectAll()
    .where('providerId', '=', providerId)
    .where('modelKey', '=', modelKey)
    .executeTakeFirst();
}

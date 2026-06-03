import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function deleteProviderModelById(id: string, trx?: Transaction) {
  return (trx || getDb())
    .deleteFrom('providerModels')
    .where('id', '=', id)
    .executeTakeFirst();
}

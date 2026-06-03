import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function deleteExtensionProviderBindings(
  extensionId: string,
  trx?: Transaction
) {
  return (trx || getDb())
    .deleteFrom('extensionProviders')
    .where('extensionId', '=', extensionId)
    .execute();
}

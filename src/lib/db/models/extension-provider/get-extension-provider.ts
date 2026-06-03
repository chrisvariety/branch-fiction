import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getExtensionProviderBindings(
  extensionId: string,
  trx?: Transaction
) {
  return (trx || getDb())
    .selectFrom('extensionProviders')
    .selectAll()
    .where('extensionId', '=', extensionId)
    .execute();
}

export async function getExtensionIdsByProvider(providerId: string, trx?: Transaction) {
  const rows = await (trx || getDb())
    .selectFrom('extensionProviders')
    .select('extensionId')
    .where('providerId', '=', providerId)
    .execute();
  return Array.from(new Set(rows.map((r) => r.extensionId)));
}

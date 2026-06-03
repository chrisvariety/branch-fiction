import { sql } from 'kysely';

import type { ProviderUpdate, Transaction } from '@/lib/db/types';

import { encryptSecret } from '../../../crypto/secret';
import { getDb } from '../../index';

export async function updateProviderById(
  id: string,
  provider: ProviderUpdate,
  trx?: Transaction
) {
  const patch =
    typeof provider.secret === 'string' && provider.secret
      ? {
          ...provider,
          secret: await encryptSecret(provider.secret),
          secretLast4: provider.secret.slice(-4)
        }
      : provider;
  return (trx || getDb())
    .updateTable('providers')
    .set({
      ...patch,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .returning(
      [
        'id',
        'name',
        'type',
        'authShape',
        'secretLast4',
        'updatedAt'
      ] /* intentionally excluding `secret` */
    )
    .executeTakeFirst();
}

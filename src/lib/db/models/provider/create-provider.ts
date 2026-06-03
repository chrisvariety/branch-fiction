import { v7 as uuidv7 } from 'uuid';

import type { NewProvider, NewProviderModel, Transaction } from '@/lib/db/types';

import { encryptSecret } from '../../../crypto/secret';
import { getDb } from '../../index';
import { createProviderModel } from '../provider-model/create-provider-model';

export async function createProvider(provider: NewProvider, trx?: Transaction) {
  const values =
    typeof provider.secret === 'string' && provider.secret
      ? {
          ...provider,
          secret: await encryptSecret(provider.secret),
          secretLast4: provider.secret.slice(-4)
        }
      : provider;
  return (trx || getDb())
    .insertInto('providers')
    .values(values)
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

export async function createProviderWithModel({
  provider,
  model
}: {
  provider: Omit<NewProvider, 'id'>;
  model: Omit<NewProviderModel, 'id' | 'providerId'>;
}): Promise<{ providerId: string; providerModelId: string }> {
  const providerId = uuidv7();
  const providerModelId = uuidv7();

  const created = await createProvider({ ...provider, id: providerId });
  if (!created) throw new Error('Failed to create provider');
  await createProviderModel({ ...model, id: providerModelId, providerId });

  return { providerId, providerModelId };
}

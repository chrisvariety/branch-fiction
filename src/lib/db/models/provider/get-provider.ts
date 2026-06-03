import { jsonArrayFrom, parseNestedJsonFields } from '../../dialect';
import { getDb } from '../../index';
import { Transaction } from '../../types';

export async function getProviderById(id: string, trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('providers')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getProvidersByOrganizationId(
  organizationId: string,
  trx?: Transaction
) {
  const rows = await (trx || getDb())
    .selectFrom('providers')
    .selectAll('providers')
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('providerModels')
          .select([
            'providerModels.id',
            'providerModels.modelKey',
            'providerModels.displayName',
            'providerModels.config',
            'providerModels.reasoning'
          ])
          .whereRef('providerModels.providerId', '=', 'providers.id')
      ).as('models')
    ])
    .where('organizationId', '=', organizationId)
    .execute();
  return rows.map((row) => parseNestedJsonFields({ models: ['config'] }, row));
}

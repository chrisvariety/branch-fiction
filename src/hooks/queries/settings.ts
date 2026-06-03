import { queryOptions } from '@tanstack/react-query';

import { DEFAULT_ORG_ID } from '@/lib/auth';
import { getProvidersByOrganizationId } from '@/lib/db/models/provider/get-provider';
import type { Provider, ProviderModel } from '@/lib/db/types';

export type ProviderPreview = Omit<
  Provider & {
    models: Pick<
      ProviderModel,
      'id' | 'modelKey' | 'displayName' | 'config' | 'reasoning'
    >[];
  },
  'secret'
>;

export async function getProvidersForUI(): Promise<ProviderPreview[]> {
  const rows = await getProvidersByOrganizationId(DEFAULT_ORG_ID);
  return rows.map(({ secret: _secret, ...rest }) => rest);
}

export const providersQueryOptions = queryOptions({
  queryKey: ['providers'],
  queryFn: getProvidersForUI
});

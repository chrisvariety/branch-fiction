import { invoke } from '@tauri-apps/api/core';
import { v7 as uuidv7 } from 'uuid';

import { getProvidersForUI } from '@/hooks/queries/settings';
import { DEFAULT_ORG_ID } from '@/lib/auth';
import { upsertProviderModel } from '@/lib/db/models/provider-model/create-provider-model';
import { deleteProviderModelById } from '@/lib/db/models/provider-model/delete-provider-model';
import {
  createProvider,
  createProviderWithModel
} from '@/lib/db/models/provider/create-provider';
import { updateProviderById } from '@/lib/db/models/provider/update-provider';
import type { NewProvider, NewProviderModel, ProviderUpdate } from '@/lib/db/types';
import type { TestProviderResult } from '@/lib/llm/providers';

export const providerFormProps = {
  listProviders: () => getProvidersForUI(),
  testProviderConfig: (params: {
    providerType: string;
    apiKey: string | null;
    apiKeyEnvVar: string | null;
    baseUrl: string | null;
    modelId: string;
  }) => invoke<TestProviderResult>('test_provider_config', { params }),
  upsertProvider: async (data: NewProvider | (ProviderUpdate & { id?: string })) => {
    if ('id' in data && data.id) {
      const { id, ...rest } = data;
      return updateProviderById(id, rest);
    }
    return createProvider({
      ...data,
      id: uuidv7(),
      organizationId: DEFAULT_ORG_ID
    } as NewProvider);
  },
  upsertProviderModel: ({
    providerId,
    data
  }: {
    providerId: string;
    data: Omit<NewProviderModel, 'providerId'>;
  }) => upsertProviderModel({ ...data, providerId }),
  removeProviderModel: async ({ id }: { id: string }) => {
    await deleteProviderModelById(id);
    return { ok: true } as const;
  },
  createProviderWithModel: ({
    provider,
    model
  }: {
    provider: Omit<NewProvider, 'id' | 'organizationId'>;
    model: Omit<NewProviderModel, 'id' | 'providerId'>;
  }) =>
    createProviderWithModel({
      provider: { ...provider, organizationId: DEFAULT_ORG_ID },
      model
    })
};

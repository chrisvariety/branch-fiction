import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

export type ExtensionDevClient = {
  extensionId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type ExtensionDevPairCode = {
  code: string;
  expiresAt: number;
};

export const extensionDevClientsQueryOptions = queryOptions({
  queryKey: ['extension-dev-clients'],
  queryFn: async (): Promise<ExtensionDevClient[]> => {
    return invoke<ExtensionDevClient[]>('extension_dev_clients_list');
  }
});

export function useCreateExtensionDevCode() {
  return useMutation({
    mutationFn: async (): Promise<ExtensionDevPairCode> => {
      return invoke<ExtensionDevPairCode>('extension_dev_code_create');
    }
  });
}

export function useRevokeExtensionDevClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (extensionId: string) => {
      await invoke('extension_dev_client_revoke', { extensionId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extension-dev-clients'] });
    }
  });
}

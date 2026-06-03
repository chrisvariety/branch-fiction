import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  checkExtensionUpdate,
  commitExtensionInstall,
  listInstalledExtensions,
  listExtensionBindings,
  setExtensionEnabled,
  setExtensionProviderModel,
  uninstallExtension,
  updateExtensionConfig,
  updateSourceUrl,
  type CommitInstallArgs,
  type ExtensionProviderBinding,
  type ExtensionUpdateResult
} from '@/extensions/install';
import type { ExtensionManifestV1 } from '@/extensions/manifest';
import type { Extension as DbExtension } from '@/lib/db/types';

export type InstalledExtension = Omit<DbExtension, 'manifest'> & {
  manifest: ExtensionManifestV1;
};

export const extensionsQueryOptions = queryOptions({
  queryKey: ['extensions'],
  queryFn: async (): Promise<InstalledExtension[]> => {
    return (await listInstalledExtensions()) as InstalledExtension[];
  }
});

export const extensionBindingsQueryOptions = queryOptions({
  queryKey: ['extension-bindings'],
  queryFn: async (): Promise<ExtensionProviderBinding[]> => {
    return listExtensionBindings();
  }
});

export function useCommitExtensionInstall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: CommitInstallArgs) => {
      return (await commitExtensionInstall(args)) as InstalledExtension;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
      void queryClient.invalidateQueries({ queryKey: ['extension-bindings'] });
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    }
  });
}

export function useSetExtensionEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await setExtensionEnabled(id, enabled);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
    }
  });
}

export function useUpdateExtensionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      config
    }: {
      id: string;
      config: Record<string, unknown>;
    }) => {
      await updateExtensionConfig(id, config);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
    }
  });
}

export function useSetExtensionProviderModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      extensionId: string;
      providerKey: string;
      modelKey: string;
    }) => {
      await setExtensionProviderModel(args);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    }
  });
}

export function useCheckExtensionUpdates() {
  return useMutation({
    mutationFn: async (
      extensions: InstalledExtension[]
    ): Promise<Record<string, ExtensionUpdateResult>> => {
      const targets = extensions.filter((p) => updateSourceUrl(p) !== null);
      const results = await Promise.all(
        targets.map(async (p) => [p.id, await checkExtensionUpdate(p)] as const)
      );
      return Object.fromEntries(results);
    }
  });
}

export function useUninstallExtension() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await uninstallExtension(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
      void queryClient.invalidateQueries({ queryKey: ['extension-bindings'] });
    }
  });
}

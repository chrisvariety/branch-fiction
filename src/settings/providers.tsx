import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useState } from 'react';

import { getProviderIcon } from '@/components/icons/provider-icons';
import { AdvancedProviderForm } from '@/components/provider/advanced';
import { providerFormProps } from '@/components/provider/form-props';
import { revokeSession } from '@/extensions/session-tokens';
import {
  extensionBindingsQueryOptions,
  extensionsQueryOptions,
  type InstalledExtension
} from '@/hooks/queries/extensions';
import { providersQueryOptions, type ProviderPreview } from '@/hooks/queries/settings';
import { CLOUD_PROVIDER_TYPE } from '@/lib/cloud';
import { broadcastInvalidate } from '@/lib/cross-window-invalidate';
import { removeProvider } from '@/lib/db/models/provider/delete-provider';
import { getProviderEntry } from '@/lib/llm/providers';

type View =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; provider: ProviderPreview };

export function ProvidersPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ kind: 'list' });

  const handleProvider = () => {
    void queryClient.invalidateQueries({ queryKey: ['providers'] });
    void broadcastInvalidate();
    setView({ kind: 'list' });
  };

  if (view.kind === 'add') {
    return (
      <AdvancedProviderForm
        {...providerFormProps}
        onBack={() => setView({ kind: 'list' })}
        onProvider={handleProvider}
        onOpenExternal={(url) => void openUrl(url)}
      />
    );
  }

  if (view.kind === 'edit') {
    return (
      <AdvancedProviderForm
        {...providerFormProps}
        provider={view.provider}
        onBack={() => setView({ kind: 'list' })}
        onProvider={handleProvider}
        onOpenExternal={(url) => void openUrl(url)}
      />
    );
  }

  return (
    <ProvidersList
      onAdd={() => setView({ kind: 'add' })}
      onEdit={(provider) => setView({ kind: 'edit', provider })}
    />
  );
}

function ProvidersList({
  onAdd,
  onEdit
}: {
  onAdd: () => void;
  onEdit: (provider: ProviderPreview) => void;
}) {
  const providers = useQuery(providersQueryOptions);
  const extensions = useQuery(extensionsQueryOptions);
  const bindings = useQuery(extensionBindingsQueryOptions);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (provider: ProviderPreview) => {
      const dependentIds = dependentExtensionIds(provider.id, bindings.data ?? []);
      const names = extensionNames(dependentIds, extensions.data ?? []);
      const noun = names.length === 1 ? 'extension' : 'extensions';
      const warning =
        names.length > 0
          ? `\n\nThe following ${noun} will need to be configured again: ${formatExtensionList(names)}.`
          : '';
      const confirmed = await ask(`Delete "${provider.name}"?${warning}`, {
        title: 'Delete provider',
        kind: 'warning',
        okLabel: 'Delete',
        cancelLabel: 'Cancel'
      });
      if (!confirmed) return;
      try {
        await removeProvider(provider.id);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await message(detail, { title: 'Cannot delete provider', kind: 'error' });
        throw err;
      }
      // Drop live sessions so affected extensions re-mint without the deleted credentials.
      await Promise.all(dependentIds.map((id) => revokeSession(id).catch(() => {})));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
      void queryClient.invalidateQueries({ queryKey: ['extension-bindings'] });
      void broadcastInvalidate();
    }
  });

  const rows = providers.data ?? [];

  return (
    <div className="flex flex-col pb-6">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background pb-4">
        <div>
          <h2 className="text-sm font-medium">Providers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure API credentials for each provider.
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <IconPlus className="size-3.5" />
          Add Provider
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            onEdit={() => onEdit(provider)}
            onDelete={() => deleteMutation.mutate(provider)}
            disabled={deleteMutation.isPending}
          />
        ))}

        {rows.length === 0 && !providers.isLoading && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No providers configured. Add one to get started.
          </p>
        )}
      </div>
    </div>
  );
}

function dependentExtensionIds(
  providerId: string,
  bindings: { extensionId: string; providerId: string }[]
): string[] {
  const ids = new Set<string>();
  for (const b of bindings) {
    if (b.providerId === providerId) ids.add(b.extensionId);
  }
  return Array.from(ids);
}

function extensionNames(ids: string[], extensions: InstalledExtension[]): string[] {
  const nameById = new Map(extensions.map((p) => [p.id, p.name]));
  return ids.map((id) => nameById.get(id) ?? id);
}

function formatExtensionList(names: string[]): string {
  const quoted = names.map((n) => `"${n}"`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;
}

function credentialLabel(provider: ProviderPreview): string {
  if (
    provider.authShape &&
    'kind' in provider.authShape &&
    provider.authShape.kind === 'none'
  ) {
    return 'No auth';
  }
  if (provider.secretPriority === 'env') {
    return provider.secretEnvVar ? `Env: ${provider.secretEnvVar}` : 'Env: not set';
  }
  return provider.secretLast4 ? `••••${provider.secretLast4}` : 'No key';
}

function ProviderCard({
  provider,
  onEdit,
  onDelete,
  disabled
}: {
  provider: ProviderPreview;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const Icon = getProviderIcon(provider.type);
  const typeLabel = getProviderEntry(provider.type)?.name ?? provider.type;
  const isCloud = provider.type === CLOUD_PROVIDER_TYPE;

  return (
    <div className="flex items-center gap-3 border border-border p-3">
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{provider.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {isCloud ? (
            'This provider is managed by your cloud subscription'
          ) : (
            <>
              {typeLabel} · {credentialLabel(provider)}
              {provider.models[0]
                ? ` · ${provider.models[0].displayName ?? provider.models[0].modelKey}`
                : ''}
              {provider.baseUrl ? ` · ${provider.baseUrl}` : ''}
            </>
          )}
        </p>
      </div>
      {!isCloud && (
        <>
          <button
            type="button"
            onClick={onEdit}
            title="Edit provider"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconPencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            title="Delete provider"
            className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
          >
            <IconTrash className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

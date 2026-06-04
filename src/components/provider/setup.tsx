import { IconCloud, IconKey } from '@tabler/icons-react';
import { useState } from 'react';

import { CloudAccess } from '@/components/cloud/access';

import {
  AdvancedProviderForm,
  type CreateProviderWithModel,
  type ListProviders,
  type RemoveProviderModel,
  type TestProviderConfig,
  type UpsertProvider,
  type UpsertProviderModel
} from './advanced';

export type LinkCloudAccount = (params: { externalId: string }) => Promise<{ ok: true }>;

type ProviderSetupProps = {
  onOpenExternal: (url: string) => void;
  onProvider: () => void;
  listProviders: ListProviders;
  testProviderConfig: TestProviderConfig;
  upsertProvider: UpsertProvider;
  upsertProviderModel: UpsertProviderModel;
  removeProviderModel: RemoveProviderModel;
  createProviderWithModel: CreateProviderWithModel;
  linkCloudAccount: LinkCloudAccount;
};

export function ProviderSetup({
  onOpenExternal,
  onProvider,
  listProviders,
  testProviderConfig,
  upsertProvider,
  upsertProviderModel,
  removeProviderModel,
  createProviderWithModel,
  linkCloudAccount
}: ProviderSetupProps) {
  const [view, setView] = useState<'chooser' | 'cloud' | 'advanced'>('chooser');

  if (view === 'cloud') {
    return (
      <CloudAccess
        onBack={() => setView('chooser')}
        onOpenExternal={onOpenExternal}
        invalidationQueryKeys={[['providers'], ['extensions'], ['extension-bindings']]}
        linkCloudAccount={(externalId) => linkCloudAccount({ externalId })}
      />
    );
  }

  if (view === 'advanced') {
    return (
      <AdvancedProviderForm
        onBack={() => setView('chooser')}
        onProvider={onProvider}
        onOpenExternal={onOpenExternal}
        listProviders={listProviders}
        testProviderConfig={testProviderConfig}
        upsertProvider={upsertProvider}
        upsertProviderModel={upsertProviderModel}
        removeProviderModel={removeProviderModel}
        createProviderWithModel={createProviderWithModel}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <h2 className="font-serif text-xl tracking-tight text-balance">
          Choose a provider
        </h2>
        <div className="h-px w-8 bg-border" />
      </div>

      <div className="mt-6 w-full max-w-sm space-y-6">
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          We need an LLM provider to import and analyze books. Pick how you'd like to
          connect.
        </p>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setView('cloud')}
            className="flex w-full items-start gap-3 border border-border p-4 text-left transition-colors hover:bg-muted/40"
          >
            <IconCloud className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Cloud Access</p>
              <p className="text-xs text-muted-foreground">
                One subscription, no API keys to manage.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setView('advanced')}
            className="flex w-full items-start gap-3 border border-border p-4 text-left transition-colors hover:bg-muted/40"
          >
            <IconKey className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Bring your own key</p>
              <p className="text-xs text-muted-foreground">
                Connect any major LLM provider, a local model, or a custom endpoint.
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

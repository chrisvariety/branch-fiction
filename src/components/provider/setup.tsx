import {
  AdvancedProviderForm,
  type CreateProviderWithModel,
  type ListProviders,
  type RemoveProviderModel,
  type TestProviderConfig,
  type UpsertProvider,
  type UpsertProviderModel
} from './advanced';

type ProviderSetupProps = {
  onOpenExternal: (url: string) => void;
  onProvider: () => void;
  listProviders: ListProviders;
  testProviderConfig: TestProviderConfig;
  upsertProvider: UpsertProvider;
  upsertProviderModel: UpsertProviderModel;
  removeProviderModel: RemoveProviderModel;
  createProviderWithModel: CreateProviderWithModel;
};

export function ProviderSetup({
  onOpenExternal,
  onProvider,
  listProviders,
  testProviderConfig,
  upsertProvider,
  upsertProviderModel,
  removeProviderModel,
  createProviderWithModel
}: ProviderSetupProps) {
  return (
    <AdvancedProviderForm
      title="Choose a provider"
      intro="We need an LLM provider to import and analyze books. Pick how you'd like to connect."
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

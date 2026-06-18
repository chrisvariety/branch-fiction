import {
  buildPiModel,
  type PiModelHandle
} from '@branch-fiction/extension-sdk/pi-handle';

// aligns with manifest.json
type ProviderKey = 'text' | 'image_generation_reference' | 'avatar';

export function getProvider(key: ProviderKey): ProviderBinding {
  const provider = host.providers[key];
  if (!provider) throw new Error(`Missing provider binding for key: ${key}`);
  return provider;
}

export { type PiModelHandle };

export function getPiModel(key: 'text'): PiModelHandle {
  const provider = getProvider(key);
  if (!provider.providerType || !provider.modelKey) {
    throw new Error(
      `Provider "${key}" missing useSlot data — manifest must declare useSlot`
    );
  }
  return buildPiModel({
    providerType: provider.providerType,
    apiKey: 'unused-proxy-injects',
    baseUrl: provider.proxyBaseURL,
    modelId: provider.modelKey,
    reasoning: provider.reasoning ?? null
  });
}

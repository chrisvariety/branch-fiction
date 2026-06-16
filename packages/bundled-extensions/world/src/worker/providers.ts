import {
  buildPiModel,
  type PiModelHandle
} from '@branch-fiction/extension-sdk/pi-handle';
import { type ImagesApi, type ImagesModel } from '@earendil-works/pi-ai';

// aligns with manifest.json
type ProviderKey = 'text' | 'image_generation_seed' | 'reactor_token';

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

// Maps an image provider option's baseURL to the pi-ai images API that speaks its protocol.
const BASE_URL_TO_IMAGES_API: Record<string, ImagesApi> = {
  'https://generativelanguage.googleapis.com/v1beta': 'gemini-images',
  'https://api.openai.com/v1': 'openai-images',
  'https://api.x.ai/v1': 'xai-images',
  'https://fal.run': 'fal-images',
  'https://openrouter.ai/api/v1': 'openrouter-images'
};

// The proxy injects the real API key, so baseUrl points at proxyBaseURL and the key is a placeholder.
export function buildImagesModel(provider: ProviderBinding): ImagesModel<ImagesApi> {
  if (!provider.modelKey) {
    throw new Error('Image provider has no modelKey configured');
  }
  const api = BASE_URL_TO_IMAGES_API[provider.baseURL];
  if (!api) {
    throw new Error(`Unsupported image provider baseURL: ${provider.baseURL}`);
  }
  return {
    id: provider.modelKey,
    name: provider.modelKey,
    api,
    provider: api,
    baseUrl: provider.proxyBaseURL,
    input: ['text', 'image'],
    output: ['image', 'text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
}

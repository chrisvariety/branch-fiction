import {
  buildPiModel,
  type PiModelHandle
} from '@branch-fiction/extension-sdk/pi-handle';
import { type ImagesApi, type ImagesModel } from '@earendil-works/pi-ai';

import { type SegmentationProvider } from '@/lib/segment/prediction';

// aligns with manifest.json
type ProviderKey =
  | 'text'
  | 'text_chat'
  | 'image_evaluation'
  | 'image_generation_reference'
  | 'image_generation_interactive'
  | 'image_generation_chat'
  | 'image_generation_chat_intimacy'
  | 'segmentation';

export type ChatImageProviderKey =
  | 'image_generation_chat'
  | 'image_generation_chat_intimacy';

export const DEFAULT_CHAT_IMAGE_PROVIDER_KEY: ChatImageProviderKey =
  'image_generation_chat';
export const INTIMACY_CHAT_IMAGE_PROVIDER_KEY: ChatImageProviderKey =
  'image_generation_chat_intimacy';

// Return the raw provider binding for a given manifest key.
export function getProvider(key: ProviderKey): ProviderBinding {
  const provider = host.providers[key];
  if (!provider) throw new Error(`Missing provider binding for key: ${key}`);
  return provider;
}

export function getChatImageProvider(storedKey: string | null): ProviderBinding {
  if (storedKey === INTIMACY_CHAT_IMAGE_PROVIDER_KEY) {
    const provider = host.providers[INTIMACY_CHAT_IMAGE_PROVIDER_KEY];
    if (provider) return provider;
  }
  return getProvider('image_generation_chat');
}

export { type PiModelHandle };

export function getPiModel(key: 'text' | 'text_chat'): PiModelHandle {
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

// Build a pi-ai model handle for the image_evaluation provider specifically. The
// host resolves a concrete provider type for every binding, so we build the same
// way as the text providers.
export function getImageEvaluationPiModel(): PiModelHandle {
  const provider = getProvider('image_evaluation');
  if (!provider.providerType || !provider.modelKey) {
    throw new Error('image_evaluation provider missing providerType/modelKey');
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
// The custom APIs are registered in src/lib/media/image-apis; `openrouter-images` is built in.
const BASE_URL_TO_IMAGES_API: Record<string, ImagesApi> = {
  'https://generativelanguage.googleapis.com/v1beta': 'gemini-images',
  'https://api.openai.com/v1': 'openai-images',
  'https://api.x.ai/v1': 'xai-images',
  'https://fal.run': 'fal-images',
  'https://openrouter.ai/api/v1': 'openrouter-images'
};

// Build a pi-ai ImagesModel for an image-generation provider binding. The proxy injects the
// real API key, so baseUrl points at proxyBaseURL and the key passed to generateImages is a
// placeholder.
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

export function getSegmentationProvider(): SegmentationProvider {
  const provider = host.providers.segmentation;
  if (!provider) throw new Error('Missing segmentation provider binding');
  // The manifest option uses `fullURL`, so the host's proxy already maps `proxyBaseURL` to the full workflow endpoint and injects the api_key.
  return {
    apiKey: 'unused-proxy-injects',
    baseUrl: provider.proxyBaseURL
  };
}

import { type ImagesApi, type ImagesModel } from '@earendil-works/pi-ai';

import type { ExtensionProviderBinding } from '../sdk-source';

// Maps an image provider baseURL to the pi-ai images API that speaks its protocol.
const BASE_URL_TO_IMAGES_API: Record<string, ImagesApi> = {
  'https://generativelanguage.googleapis.com/v1beta': 'gemini-images',
  'https://api.openai.com/v1': 'openai-images',
  'https://api.x.ai/v1': 'xai-images',
  'https://fal.run': 'fal-images',
  'https://openrouter.ai/api/v1': 'openrouter-images'
};

// proxyBaseURL is used as baseUrl because the host proxy injects the real API key.
export function buildImagesModel(
  provider: ExtensionProviderBinding
): ImagesModel<ImagesApi> {
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

import type {
  AssistantImages,
  ImagesContext,
  ImagesModel,
  ImagesOutputContent
} from '@earendil-works/pi-ai';

import type { OneShotImageOptions } from './options';

export const FAL_IMAGES_API = 'fal-images';

interface FalImageResponse {
  images?: Array<{ url?: string }>;
}

export async function generateImagesFal(
  model: ImagesModel<typeof FAL_IMAGES_API>,
  context: ImagesContext,
  options?: OneShotImageOptions
): Promise<AssistantImages> {
  const prompt = context.input
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const imageUrls = context.input
    .filter((b) => b.type === 'image')
    .map((b) => `data:${b.mimeType};base64,${b.data}`);

  // Fal pairs each model with an /edit variant (fal-ai/nano-banana-2 + fal-ai/nano-banana-2/edit).
  // Pick the variant based on ref images.
  const baseId = model.id.replace(/\/edit$/, '');
  const modelId = imageUrls.length > 0 ? `${baseId}/edit` : baseId;

  const res = await fetch(`${model.baseUrl}/${modelId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...model.headers
    },
    body: JSON.stringify({
      prompt,
      sync_mode: true,
      num_images: 1,
      enable_safety_checker: false,
      ...(imageUrls.length > 0 && { image_urls: imageUrls })
    }),
    signal: options?.signal
  });

  if (!res.ok) {
    const error = new Error(`Fal API error (${res.status}): ${await res.text()}`);
    Object.assign(error, { status: res.status });
    throw error;
  }

  const json = (await res.json()) as FalImageResponse;
  console.log('FAL RESPONSE', json);
  const url = json.images?.[0]?.url;
  const match = url?.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('NO_IMAGE');

  const output: ImagesOutputContent[] = [
    { type: 'image', mimeType: match[1], data: match[2] }
  ];

  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output,
    stopReason: 'stop',
    timestamp: Date.now()
  };
}

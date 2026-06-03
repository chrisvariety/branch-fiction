import {
  generateImages,
  type ImagesInputContent,
  type ProviderImagesOptions
} from '@earendil-works/pi-ai';
import { decode } from '@stablelib/base64';

import { buildImagesModel } from '@/worker/providers';

import { withGenAIRetry } from './generate-safely';
import type { OneShotImageOptions } from './image-apis/options';
import './image-apis/register';
import type { AspectRatio, GeneratedImage, InlineImage } from './image-types';

const defaultOnRetry = (error: Error, attempt: number, maxRetries: number) => {
  console.warn(
    `Image generation error (${error.message}), retrying (attempt ${attempt}/${maxRetries})`
  );
};

// Single-shot image generation via pi-ai's generateImages. For multi-turn flows
// (revision loop, follow-up text), use `createImageChatSession` instead.
export async function generateOneShotImage(
  provider: ProviderBinding,
  args: {
    prompt: string;
    refImages?: InlineImage[];
    aspectRatio?: AspectRatio;
    onRetry?: (error: Error, attempt: number, maxRetries: number) => void;
  }
): Promise<GeneratedImage> {
  const model = buildImagesModel(provider);

  const input: ImagesInputContent[] = [];
  if (args.prompt) input.push({ type: 'text', text: args.prompt });
  for (const img of args.refImages ?? []) {
    input.push({ type: 'image', mimeType: img.mimeType, data: img.data });
  }

  const options: OneShotImageOptions = {
    aspectRatio: args.aspectRatio
  };

  const image = await withGenAIRetry(
    async () => {
      const result = await generateImages(
        model,
        { input },
        options as ProviderImagesOptions
      );
      if (result.stopReason === 'error') {
        throw new Error(result.errorMessage ?? 'Image generation failed');
      }
      const block = result.output.find((b) => b.type === 'image');
      if (!block) throw new Error('NO_IMAGE');
      return block;
    },
    { onRetry: args.onRetry ?? defaultOnRetry }
  );

  return { mimeType: image.mimeType, data: decode(image.data) };
}

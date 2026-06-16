import type {
  AssistantImages,
  ImagesContext,
  ImagesModel,
  ImagesOutputContent
} from '@earendil-works/pi-ai';

import { ImageSafetyError } from '../image-errors';
import type { OneShotImageOptions } from './options';

export const XAI_IMAGES_API = 'xai-images';

interface XaiImageResponse {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
}

// https://docs.x.ai/docs/guides/image-generation
export async function generateImagesXai(
  model: ImagesModel<typeof XAI_IMAGES_API>,
  context: ImagesContext,
  options?: OneShotImageOptions
): Promise<AssistantImages> {
  const prompt = context.input
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const refImages = context.input.filter((b) => b.type === 'image');
  const editing = refImages.length > 0;

  const body: Record<string, unknown> = {
    model: model.id,
    prompt,
    response_format: 'b64_json',
    n: 1
  };
  if (editing) {
    const toDataUrl = (b: (typeof refImages)[number]) => ({
      url: `data:${b.mimeType};base64,${b.data}`
    });
    Object.assign(
      body,
      refImages.length === 1
        ? { image: toDataUrl(refImages[0]) }
        : { images: refImages.map(toDataUrl) }
    );
  }

  const res = await fetch(
    `${model.baseUrl}/images/${editing ? 'edits' : 'generations'}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...model.headers
      },
      body: JSON.stringify(body),
      signal: options?.signal
    }
  );

  if (!res.ok) {
    const bodyText = await res.text();
    if (/content moderation|moderation_blocked/i.test(bodyText)) {
      throw new ImageSafetyError(`xAI rejected prompt: ${bodyText}`);
    }
    const error = new Error(`xAI API error (${res.status}): ${bodyText}`);
    Object.assign(error, { status: res.status });
    throw error;
  }

  const json = (await res.json()) as XaiImageResponse;
  const item = json.data?.[0];
  if (!item?.b64_json) throw new Error('NO_IMAGE');

  const output: ImagesOutputContent[] = [
    { type: 'image', mimeType: 'image/png', data: item.b64_json }
  ];
  if (item.revised_prompt) output.push({ type: 'text', text: item.revised_prompt });

  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output,
    stopReason: 'stop',
    timestamp: Date.now()
  };
}

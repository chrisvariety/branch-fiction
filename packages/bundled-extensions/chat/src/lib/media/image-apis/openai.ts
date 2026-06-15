import type {
  AssistantImages,
  ImagesContext,
  ImagesModel,
  ImagesOutputContent
} from '@earendil-works/pi-ai';
import OpenAI from 'openai';

import { ImageSafetyError } from '../image-errors';
import type { AspectRatio } from '../image-types';
import type { OneShotImageOptions } from './options';

export const OPENAI_IMAGES_API = 'openai-images';

// gpt-image moderation surfaces as a 400 APIError with code "moderation_blocked".
export function isOpenAIModerationError(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIError &&
    (error.code === 'moderation_blocked' ||
      /moderation|safety system/i.test(error.message ?? ''))
  );
}

// Text model used to orchestrate the `image_generation` tool on OpenAI.
// currently not configurable :(
const OPENAI_ORCHESTRATOR_MODEL = 'gpt-5.4-mini';

export async function generateImagesOpenAI(
  model: ImagesModel<typeof OPENAI_IMAGES_API>,
  context: ImagesContext,
  options?: OneShotImageOptions
): Promise<AssistantImages> {
  const client = new OpenAI({
    apiKey: 'unused-proxy-injects',
    baseURL: model.baseUrl
  });

  const content: OpenAI.Responses.ResponseInputMessageContentList = [];
  for (const block of context.input) {
    if (block.type === 'text') {
      content.push({ type: 'input_text', text: block.text });
    } else {
      content.push({
        type: 'input_image',
        image_url: `data:${block.mimeType};base64,${block.data}`,
        detail: 'auto'
      });
    }
  }
  if (content.length === 0) {
    throw new Error('Cannot generate an image from empty input');
  }

  const imageTool: OpenAI.Responses.Tool.ImageGeneration = {
    type: 'image_generation',
    model: model.id as OpenAI.Responses.Tool.ImageGeneration['model'],
    quality: 'auto',
    output_format: 'png',
    ...(options?.aspectRatio && { size: aspectRatioToOpenAISize(options.aspectRatio) })
  };

  const response = await client.responses
    .create(
      {
        model: OPENAI_ORCHESTRATOR_MODEL,
        input: [{ role: 'user', content }],
        tools: [imageTool]
      },
      { signal: options?.signal }
    )
    .catch((error: unknown) => {
      if (isOpenAIModerationError(error)) throw new ImageSafetyError(String(error));
      throw error;
    });

  const imageCall = response.output.find(
    (o): o is Extract<typeof o, { type: 'image_generation_call' }> =>
      o.type === 'image_generation_call'
  );

  if (!imageCall?.result) {
    // Match the error message Gemini throws in the same situation.
    throw new Error('NO_IMAGE');
  }

  const output: ImagesOutputContent[] = [
    { type: 'image', mimeType: 'image/png', data: imageCall.result }
  ];
  if (response.output_text) output.push({ type: 'text', text: response.output_text });

  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output,
    stopReason: 'stop',
    timestamp: Date.now()
  };
}

function aspectRatioToOpenAISize(
  ratio: AspectRatio
): '1024x1024' | '1024x1536' | '1536x1024' {
  switch (ratio) {
    case '16:9':
      return '1536x1024';
    case '9:16':
    case '3:4':
      return '1024x1536';
    case '1:1':
      return '1024x1024';
  }
}

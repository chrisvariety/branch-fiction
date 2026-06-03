import type {
  AssistantImages,
  ImagesContext,
  ImagesModel,
  ImagesOutputContent
} from '@earendil-works/pi-ai';
import { GoogleGenAI } from '@google/genai';
import { encode } from '@stablelib/base64';

import { extractImageFromResponse, SAFETY_SETTINGS } from '../generate-safely';
import type { OneShotImageOptions } from './options';

export const GEMINI_IMAGES_API = 'gemini-images';

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export async function generateImagesGemini(
  model: ImagesModel<typeof GEMINI_IMAGES_API>,
  context: ImagesContext,
  options?: OneShotImageOptions
): Promise<AssistantImages> {
  const ai = new GoogleGenAI({
    apiKey: 'unused-proxy-injects',
    // apiVersion '' because baseUrl already includes the version segment ("/v1beta").
    httpOptions: { baseUrl: model.baseUrl, apiVersion: '' }
  });

  const parts: GeminiPart[] = [];
  for (const block of context.input) {
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else {
      parts.push({ inlineData: { mimeType: block.mimeType, data: block.data } });
    }
  }

  const response = await ai.models.generateContent({
    model: model.id,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: options?.aspectRatio ?? '1:1'
      },
      safetySettings: SAFETY_SETTINGS,
      abortSignal: options?.signal
    }
  });

  const image = extractImageFromResponse(response);

  const output: ImagesOutputContent[] = [
    { type: 'image', mimeType: image.mimeType, data: encode(image.data) }
  ];
  if (response.text) output.push({ type: 'text', text: response.text });

  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output,
    stopReason: 'stop',
    timestamp: Date.now()
  };
}

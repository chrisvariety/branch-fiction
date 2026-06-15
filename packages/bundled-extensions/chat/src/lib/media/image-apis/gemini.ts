import type {
  AssistantImages,
  ImagesContext,
  ImagesModel,
  ImagesOutputContent
} from '@earendil-works/pi-ai';
import {
  GenerateContentResponse,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Part,
  SafetySetting
} from '@google/genai';
import { decode, encode } from '@stablelib/base64';

import { ImageSafetyError } from '../image-errors';
import type { OneShotImageOptions } from './options';

export const GEMINI_IMAGES_API = 'gemini-images';

export const SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  }
];

type ExtractedImage = { data: Uint8Array; mimeType: string };

export function extractImageFromResponse(
  response: GenerateContentResponse,
  options?: { throwIfNotFound?: true }
): ExtractedImage;
export function extractImageFromResponse(
  response: GenerateContentResponse,
  options: { throwIfNotFound: false }
): ExtractedImage | null;
export function extractImageFromResponse(
  response: GenerateContentResponse,
  options?: { throwIfNotFound?: boolean }
): ExtractedImage | null {
  let imageData: Part['inlineData'];
  let responseText: string | undefined;

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.text) {
      responseText = part.text;
    } else if (part.inlineData?.data) {
      imageData = part.inlineData;
    }
  }

  if (!imageData?.data) {
    const finishReason = response.candidates?.[0]?.finishReason;

    // Image-failure finish reasons always throw, regardless of `throwIfNotFound` (callers branch on them).
    if (finishReason === 'IMAGE_OTHER' || finishReason === 'OTHER') {
      throw new Error('IMAGE_OTHER');
    }

    if (finishReason === 'NO_IMAGE') {
      throw new Error('NO_IMAGE');
    }

    if (
      finishReason === 'IMAGE_SAFETY' ||
      finishReason === 'PROHIBITED_CONTENT' ||
      finishReason === 'IMAGE_PROHIBITED_CONTENT' ||
      finishReason === 'IMAGE_RECITATION'
    ) {
      throw new ImageSafetyError();
    }

    // a text-only follow-up turn in a multi-turn chat. Let opted-in callers handle it as a null.
    if (options?.throwIfNotFound === false) return null;

    console.error('No image data found in response', response.candidates);
    throw new Error(responseText ?? finishReason ?? 'No image data');
  }

  return {
    data: decode(imageData.data),
    mimeType: imageData.mimeType || 'image/png'
  };
}

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

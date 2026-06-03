import {
  GenerateContentResponse,
  HarmBlockThreshold,
  HarmCategory,
  ImageConfig,
  Part,
  SafetySetting
} from '@google/genai';
import { decode } from '@stablelib/base64';
import pRetry from 'p-retry';

export interface ExtendedImageConfig extends ImageConfig {
  model?: string;
}

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

export async function withGenAIRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    onRetry?: (error: Error, attempt: number, maxRetries: number) => void;
  }
): Promise<T> {
  const { maxRetries = 3, onRetry } = options ?? {};

  return await pRetry(fn, {
    retries: maxRetries,
    onFailedAttempt: ({ error, attemptNumber }) => {
      if (!isRetryableGenAIError(error)) {
        throw error;
      }
      onRetry?.(error, attemptNumber, maxRetries);
    }
  });
}

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

    // Image-failure finish reasons are always errors
    // (callers branch on these error messages, so we must throw regardless of `throwIfNotFound`)
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
      throw new Error('IMAGE_SAFETY');
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

function isRetryableGenAIError(error: Error): boolean {
  const retryableStatuses = new Set([429, 500, 502, 503, 524]);
  // Network failures (fetch-based providers like xAI/Fal throw this on transient errors).
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return true;
  }
  return (
    error.message === 'IMAGE_OTHER' ||
    error.message === 'NO_IMAGE' ||
    ('status' in error && retryableStatuses.has((error as { status: number }).status))
  );
}

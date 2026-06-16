import { GoogleGenAI } from '@google/genai';
import { decode } from '@stablelib/base64';
import OpenAI from 'openai';

import { extractImageFromResponse, SAFETY_SETTINGS } from './image-apis/gemini';
import { isOpenAIModerationError } from './image-apis/openai';
import { ImageSafetyError } from './image-errors';
import { withGenAIRetry } from './image-retry';
import type { AspectRatio, GeneratedImage, InlineImage } from './image-types';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_BASE = 'https://api.openai.com/v1';

interface ChatMessage {
  text?: string;
  images?: InlineImage[];
}

type ChatResponse<Expect extends boolean = false> = {
  text: string;
  image: Expect extends true ? GeneratedImage : GeneratedImage | null;
};

export interface ImageChatSession {
  sendMessage<const Expect extends boolean = false>(
    message: string | ChatMessage,
    options?: { expectImage?: Expect }
  ): Promise<ChatResponse<Expect>>;
}

interface CreateImageChatSessionOptions {
  aspectRatio?: AspectRatio;
  onRetry?: (error: Error, attempt: number, maxRetries: number) => void;
}

const defaultOnRetry = (error: Error, attempt: number, maxRetries: number) => {
  console.warn(
    `Image generation error (${error.message}), retrying (attempt ${attempt}/${maxRetries})`
  );
};

export function createImageChatSession(
  provider: ProviderBinding,
  options: CreateImageChatSessionOptions = {}
): ImageChatSession {
  if (!provider.modelKey) {
    throw new Error('Image provider has no modelKey configured');
  }
  switch (provider.baseURL) {
    case GEMINI_BASE:
      return createGeminiImageChatSession(provider, options);
    case OPENAI_BASE:
      return createOpenAIImageChatSession(provider, options);
    default:
      throw new Error(`Unsupported image provider baseURL: ${provider.baseURL}`);
  }
}

function createGeminiImageChatSession(
  provider: ProviderBinding,
  options: CreateImageChatSessionOptions
): ImageChatSession {
  const ai = new GoogleGenAI({
    apiKey: 'unused-proxy-injects',
    // apiVersion: '' because provider.baseURL already includes the version segment ("/v1beta")
    // without this, GoogleGenAI would prepend it again.
    httpOptions: { baseUrl: provider.proxyBaseURL, apiVersion: '' }
  });

  const chat = ai.chats.create({
    model: provider.modelKey!,
    config: {
      // serviceTier: ServiceTier.FLEX, -- seems basically unusable, maybe with a looottt of retries and someone who doesn't care at all about time (5min+)
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: options.aspectRatio ?? '1:1',
        imageSize: '2K'
      },
      safetySettings: SAFETY_SETTINGS
    }
  });

  return {
    async sendMessage<const Expect extends boolean = false>(
      message: string | ChatMessage,
      sendOptions?: { expectImage?: Expect }
    ): Promise<ChatResponse<Expect>> {
      const { text, images } = normalize(message);
      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [];
      if (text) parts.push({ text });
      for (const img of images ?? []) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }

      return withGenAIRetry(
        async () => {
          const response = await chat.sendMessage({ message: parts });
          const image = sendOptions?.expectImage
            ? extractImageFromResponse(response)
            : extractImageFromResponse(response, { throwIfNotFound: false });
          return { text: response.text ?? '', image } as ChatResponse<Expect>;
        },
        { onRetry: options.onRetry ?? defaultOnRetry }
      );
    }
  };
}

// Text model used to orchestrate the `image_generation` tool on OpenAI. Not user-tunable... yet?
const OPENAI_ORCHESTRATOR_MODEL = 'gpt-5.4-mini';

function createOpenAIImageChatSession(
  provider: ProviderBinding,
  options: CreateImageChatSessionOptions
): ImageChatSession {
  const client = new OpenAI({
    apiKey: 'unused-proxy-injects',
    baseURL: provider.proxyBaseURL
  });

  const imageTool: OpenAI.Responses.Tool.ImageGeneration = {
    type: 'image_generation',
    model: provider.modelKey as OpenAI.Responses.Tool.ImageGeneration['model'],
    quality: 'auto',
    output_format: 'png',
    ...(options.aspectRatio && { size: aspectRatioToOpenAISize(options.aspectRatio) })
  };

  let previousResponseId: string | null = null;

  return {
    async sendMessage<const Expect extends boolean = false>(
      message: string | ChatMessage,
      sendOptions?: { expectImage?: Expect }
    ): Promise<ChatResponse<Expect>> {
      const { text, images } = normalize(message);

      const content: OpenAI.Responses.ResponseInputMessageContentList = [];
      if (text) content.push({ type: 'input_text', text });
      for (const img of images ?? []) {
        content.push({
          type: 'input_image',
          image_url: `data:${img.mimeType};base64,${img.data}`,
          detail: 'auto'
        });
      }
      if (content.length === 0) {
        throw new Error('Cannot send an empty message');
      }

      return withGenAIRetry(
        async () => {
          const response = await client.responses
            .create({
              model: OPENAI_ORCHESTRATOR_MODEL,
              ...(previousResponseId && { previous_response_id: previousResponseId }),
              input: [{ role: 'user', content }],
              tools: [imageTool]
            })
            .catch((error: unknown) => {
              if (isOpenAIModerationError(error))
                throw new ImageSafetyError(String(error));
              throw error;
            });

          previousResponseId = response.id;

          const imageCall = response.output.find(
            (o): o is Extract<typeof o, { type: 'image_generation_call' }> =>
              o.type === 'image_generation_call'
          );

          const image: GeneratedImage | null = imageCall?.result
            ? { mimeType: 'image/png', data: decode(imageCall.result) }
            : null;

          // Match the error message Gemini throws in the same situation
          if (sendOptions?.expectImage && !image) {
            throw new Error('NO_IMAGE');
          }

          return { text: response.output_text ?? '', image } as ChatResponse<Expect>;
        },
        { onRetry: options.onRetry ?? defaultOnRetry }
      );
    }
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

function normalize(message: string | ChatMessage): ChatMessage {
  return typeof message === 'string' ? { text: message } : message;
}

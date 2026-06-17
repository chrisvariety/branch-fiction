import { generateOneShotImage } from '@branch-fiction/extension-sdk/media/generate-one-shot-image';
import { isImageSafetyError } from '@branch-fiction/extension-sdk/media/image-errors';
import {
  assemblePrompt,
  type StructuredPrompt
} from '@branch-fiction/extension-sdk/media/image-models';
import type {
  AspectRatio,
  GeneratedImage,
  InlineImage
} from '@branch-fiction/extension-sdk/media/image-types';
import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import { v7 as uuidv7 } from 'uuid';

import { getPiModel } from '@/worker/providers';

const SAFETY_REWRITE_SYSTEM_PROMPT = `The following image generation prompt triggered a safety violation. Rewrite it to pass image safety filters while keeping the scene's emotion, tension, and atmosphere intact. Rather than removing the intimacy, use creative composition to convey it: shift the camera to faces and upper bodies, use over-the-shoulder or profile angles, add strategic coverings (hands, sheets, clothing, shadows), or frame the shot to be suggestive and evocative without showing explicit imagery. Output only the rewritten prompt, with no preamble or explanation.`;

// Rewrites a prompt to avoid triggering image safety filters.
export async function rewriteForSafety(prompt: string): Promise<string> {
  console.log('Rewriting prompt to avoid safety filters...');

  const { model, apiKey, reasoning } = getPiModel('text_chat');
  const message = await completeOrThrow(
    model,
    {
      systemPrompt: SAFETY_REWRITE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }]
    },
    { apiKey, reasoning, sessionId: uuidv7() }
  );

  const rewrittenPrompt = getAssistantText(message);
  if (!rewrittenPrompt) {
    throw new Error('Failed to rewrite prompt for safety');
  }

  console.log('Rewritten prompt for safety:', rewrittenPrompt);
  return rewrittenPrompt;
}

// On a safety rejection, rewrites only the scene `content` (preserving `prefix`/`suffix`) and retries once.
export async function generateImageWithSafetyRewrite(
  provider: ProviderBinding,
  args: {
    prompt: StructuredPrompt;
    refImages?: InlineImage[];
    aspectRatio?: AspectRatio;
  }
): Promise<GeneratedImage> {
  try {
    return await generateOneShotImage(provider, {
      prompt: assemblePrompt(args.prompt),
      refImages: args.refImages,
      aspectRatio: args.aspectRatio
    });
  } catch (error) {
    if (!isImageSafetyError(error)) throw error;

    const safeContent = await rewriteForSafety(args.prompt.content);
    return generateOneShotImage(provider, {
      prompt: assemblePrompt({ ...args.prompt, content: safeContent }),
      refImages: args.refImages,
      aspectRatio: args.aspectRatio
    });
  }
}

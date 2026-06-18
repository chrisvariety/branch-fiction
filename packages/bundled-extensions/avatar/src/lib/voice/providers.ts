export const OPENAI_BASE = 'https://api.openai.com/v1';
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function getVoiceProvider(
  key: 'speech_to_text' | 'text_to_speech'
): ProviderBinding {
  const provider = window.extensionSDK.providers[key];
  if (!provider) {
    throw new Error(`Missing provider binding for key: ${key}`);
  }
  return provider;
}

// Gemini REST returns camelCase inlineData; accept snake_case defensively too.
export function readInlineAudio(part: unknown): { data: string } | null {
  if (!part || typeof part !== 'object') return null;
  const p = part as Record<string, unknown>;
  const inline = (p.inlineData ?? p.inline_data) as Record<string, unknown> | undefined;
  if (inline && typeof inline.data === 'string') return { data: inline.data };
  return null;
}

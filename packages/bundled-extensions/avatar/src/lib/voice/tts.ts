import { base64ToBytes } from './audio';
import { GEMINI_BASE, OPENAI_BASE, readInlineAudio } from './providers';

// Both OpenAI ("pcm") and Gemini TTS return signed 16-bit mono PCM at 24 kHz.
const TTS_SAMPLE_RATE = 24_000;

export interface SynthesizedAudio {
  pcm16: Uint8Array;
  sampleRate: number;
}

async function synthOpenAI(
  provider: ProviderBinding,
  text: string
): Promise<SynthesizedAudio> {
  const res = await fetch(`${provider.proxyBaseURL}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.modelKey ?? 'gpt-4o-mini-tts',
      input: text,
      voice: 'alloy',
      response_format: 'pcm'
    })
  });
  if (!res.ok) {
    throw new Error(`Speech synthesis failed: ${res.status} ${await res.text()}`);
  }
  return { pcm16: new Uint8Array(await res.arrayBuffer()), sampleRate: TTS_SAMPLE_RATE };
}

async function synthGemini(
  provider: ProviderBinding,
  text: string
): Promise<SynthesizedAudio> {
  const model = provider.modelKey ?? 'gemini-2.5-flash-preview-tts';
  const res = await fetch(`${provider.proxyBaseURL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
        }
      }
    })
  });
  if (!res.ok) {
    throw new Error(`Speech synthesis failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: unknown[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = readInlineAudio(part);
    if (inline) return { pcm16: base64ToBytes(inline.data), sampleRate: TTS_SAMPLE_RATE };
  }
  throw new Error('Speech synthesis returned no audio');
}

// Text-to-speech via the user-selected provider; dispatched on the bound baseURL.
export async function synthesize(
  provider: ProviderBinding,
  text: string
): Promise<SynthesizedAudio> {
  if (provider.baseURL === OPENAI_BASE) return synthOpenAI(provider, text);
  if (provider.baseURL === GEMINI_BASE) return synthGemini(provider, text);
  throw new Error(`Unsupported text-to-speech provider: ${provider.baseURL}`);
}

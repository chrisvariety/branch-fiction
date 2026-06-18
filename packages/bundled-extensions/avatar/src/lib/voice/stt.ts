import { bytesToBase64 } from './audio';
import { GEMINI_BASE, OPENAI_BASE } from './providers';

const TRANSCRIBE_INSTRUCTION =
  'Transcribe the speech in this audio verbatim. Output only the transcript text with no preamble or commentary.';

function filenameFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'speech.mp4';
  if (mimeType.includes('webm')) return 'speech.webm';
  if (mimeType.includes('wav')) return 'speech.wav';
  return 'speech.dat';
}

async function transcribeOpenAI(provider: ProviderBinding, audio: Blob): Promise<string> {
  const form = new FormData();
  form.append('file', audio, filenameFor(audio.type));
  form.append('model', provider.modelKey ?? 'gpt-4o-transcribe');
  const res = await fetch(`${provider.proxyBaseURL}/audio/transcriptions`, {
    method: 'POST',
    body: form
  });
  if (!res.ok) {
    throw new Error(`Transcription failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}

async function transcribeGemini(provider: ProviderBinding, audio: Blob): Promise<string> {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const model = provider.modelKey ?? 'gemini-2.5-flash';
  const res = await fetch(`${provider.proxyBaseURL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: audio.type || 'audio/mp4',
                data: bytesToBase64(bytes)
              }
            },
            { text: TRANSCRIBE_INSTRUCTION }
          ]
        }
      ],
      generationConfig: { temperature: 0 }
    })
  });
  if (!res.ok) {
    throw new Error(`Transcription failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

// Speech-to-text via the user-selected provider; dispatched on the bound baseURL.
export async function transcribe(
  provider: ProviderBinding,
  audio: Blob
): Promise<string> {
  if (provider.baseURL === OPENAI_BASE) return transcribeOpenAI(provider, audio);
  if (provider.baseURL === GEMINI_BASE) return transcribeGemini(provider, audio);
  throw new Error(`Unsupported speech-to-text provider: ${provider.baseURL}`);
}

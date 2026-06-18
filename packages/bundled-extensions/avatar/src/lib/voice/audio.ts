export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Prefer a capture format both OpenAI and Gemini transcription accept.
export function pickRecorderMimeType(): string | undefined {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const supported = (
    globalThis as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }
  ).MediaRecorder?.isTypeSupported;
  if (!supported) return undefined;
  return candidates.find((t) => supported(t));
}

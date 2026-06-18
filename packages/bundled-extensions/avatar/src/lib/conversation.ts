import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import { buildPiModel } from '@branch-fiction/extension-sdk/pi-handle';
import type { Message, Model, Api, ThinkingLevel } from '@earendil-works/pi-ai';
import { v7 as uuidv7 } from 'uuid';

import type { AvatarSession } from '@/lib/avatar';
import { pickRecorderMimeType } from '@/lib/voice/audio';
import { transcribe } from '@/lib/voice/stt';
import { synthesize } from '@/lib/voice/tts';

export type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface ConversationCallbacks {
  onStateChange?(state: ConversationState): void;
  onTranscript?(role: 'user' | 'avatar', text: string): void;
  onError?(message: string): void;
}

export interface ConversationConfig {
  avatarSession: AvatarSession;
  systemPrompt: string;
  stt: ProviderBinding;
  tts: ProviderBinding;
  callbacks?: ConversationCallbacks;
}

function getTextModel(): {
  model: Model<Api>;
  apiKey?: string;
  reasoning?: ThinkingLevel;
} {
  const p = window.extensionSDK.providers['text'];
  if (!p?.providerType || !p.modelKey) {
    throw new Error('Text model (piText) is not configured for this extension');
  }
  return buildPiModel({
    providerType: p.providerType,
    apiKey: 'unused-proxy-injects',
    baseUrl: p.proxyBaseURL,
    modelId: p.modelKey,
    reasoning: p.reasoning ?? null
  });
}

// Push-to-talk loop: mic segment -> STT -> piText (persona + tools) -> TTS -> avatar.
export class Conversation {
  private state: ConversationState = 'idle';
  private history: Message[] = [];
  private readonly sessionId = uuidv7();
  private readonly model: Model<Api>;
  private readonly apiKey?: string;
  private readonly reasoning?: ThinkingLevel;

  private micStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string | undefined;

  constructor(private readonly cfg: ConversationConfig) {
    const handle = getTextModel();
    this.model = handle.model;
    this.apiKey = handle.apiKey;
    this.reasoning = handle.reasoning;
  }

  getState(): ConversationState {
    return this.state;
  }

  private setState(state: ConversationState): void {
    this.state = state;
    this.cfg.callbacks?.onStateChange?.(state);
  }

  async startListening(): Promise<void> {
    if (this.state === 'listening' || this.state === 'thinking') return;
    // Pressing talk barges in on any in-flight avatar speech.
    this.cfg.avatarSession.interrupt();
    this.micStream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType ??= pickRecorderMimeType();
    this.chunks = [];
    this.recorder = new MediaRecorder(
      this.micStream,
      this.mimeType ? { mimeType: this.mimeType } : undefined
    );
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.setState('listening');
  }

  async stopListening(): Promise<void> {
    const recorder = this.recorder;
    if (this.state !== 'listening' || !recorder) return;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(this.chunks, { type: this.mimeType ?? 'audio/mp4' }));
      recorder.stop();
    });
    this.recorder = null;
    await this.runTurn(blob);
  }

  private async runTurn(audio: Blob): Promise<void> {
    try {
      this.setState('thinking');
      const transcript = await transcribe(this.cfg.stt, audio);
      if (!transcript) {
        this.setState('idle');
        return;
      }
      this.cfg.callbacks?.onTranscript?.('user', transcript);
      this.history.push({ role: 'user', content: transcript, timestamp: Date.now() });

      const reply = await completeOrThrow(
        this.model,
        // tools: [] is the extension point for tool calling (Runway-style).
        { systemPrompt: this.cfg.systemPrompt, messages: this.history, tools: [] },
        { apiKey: this.apiKey, reasoning: this.reasoning, sessionId: this.sessionId }
      );
      this.history.push(reply);
      const text = getAssistantText(reply).trim();
      if (!text) {
        this.setState('idle');
        return;
      }
      this.cfg.callbacks?.onTranscript?.('avatar', text);

      this.setState('speaking');
      const synthesized = await synthesize(this.cfg.tts, text);
      this.cfg.avatarSession.playPcm16(synthesized.pcm16, synthesized.sampleRate);
      this.setState('idle');
    } catch (e) {
      this.cfg.callbacks?.onError?.(e instanceof Error ? e.message : String(e));
      this.setState('error');
    }
  }

  close(): void {
    try {
      this.recorder?.stop();
    } catch {
      /* already stopped */
    }
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.recorder = null;
  }
}

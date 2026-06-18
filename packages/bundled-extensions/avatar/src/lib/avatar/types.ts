// Provider-agnostic talking-avatar abstraction; LemonSlice over a realtime transport room.

export interface AvatarSession {
  // Enqueue mono PCM16 for the avatar to speak; chunks play back-to-back.
  playPcm16(bytes: Uint8Array, sampleRate: number): void;
  interrupt(): void;
  close(): Promise<void>;
}

export interface StartSessionOptions {
  livekitUrl: string;
  livekitToken: string;
  avatarIdentity: string;
  sessionId: string;
  avatarProxyBaseURL: string;
  videoElement: HTMLVideoElement;
  audioElement: HTMLAudioElement;
  onError?: (detail: string) => void;
}

export interface AvatarAdapter {
  readonly provider: string;
  startSession(opts: StartSessionOptions): Promise<AvatarSession>;
}

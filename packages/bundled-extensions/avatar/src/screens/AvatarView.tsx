import { IconMicrophone, IconPhoneOff } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { PickableCharacter } from '@/iframe/db/entities';
import { getAvatar } from '@/iframe/db/models/avatar/get-avatar';
import { type AvatarSession, getAvatarAdapter } from '@/lib/avatar';
import { Conversation, type ConversationState } from '@/lib/conversation';
import { getVoiceProvider } from '@/lib/voice/providers';
import type { StartAvatarSessionResult } from '@/worker/start-avatar-session';

function buildSystemPrompt(name: string, personality: string): string {
  return [
    `You are ${name}, a character speaking with a reader in a live voice conversation.`,
    'Stay fully in character. Never mention that you are an AI, a model, or a persona.',
    'Speak the way someone talks out loud: a few sentences at most, no lists or markdown.',
    '',
    'Your character:',
    personality
  ].join('\n');
}

const STATE_LABEL: Record<ConversationState, string> = {
  idle: 'Hold to talk',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Something went wrong'
};

export function AvatarView({
  bookId,
  character,
  onExit
}: {
  bookId: string;
  character: PickableCharacter;
  onExit: () => void;
}) {
  const avatar = useQuery({
    queryKey: ['avatar', bookId, character.id],
    queryFn: () => getAvatar(bookId, character.id)
  });

  if (avatar.isLoading) {
    return <Centered>Loading…</Centered>;
  }
  if (!avatar.data?.imageUrl) {
    return (
      <Centered>
        <p className="text-sm text-red-400">This character doesn’t have an avatar yet.</p>
        <BackButton onExit={onExit} />
      </Centered>
    );
  }

  return (
    <Call
      name={character.name}
      characterId={character.id}
      personality={avatar.data.personality}
      onExit={onExit}
    />
  );
}

function Call({
  name,
  characterId,
  personality,
  onExit
}: {
  name: string;
  characterId: string;
  personality: string;
  onExit: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const convoRef = useRef<Conversation | null>(null);
  const [state, setState] = useState<ConversationState>('idle');
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userText, setUserText] = useState('');
  const [avatarText, setAvatarText] = useState('');

  useEffect(() => {
    let session: AvatarSession | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const provider = window.extensionSDK.providers['avatar'];
        if (!provider) throw new Error('Avatar provider is not configured');

        const room = await window.extensionSDK.worker.spawn<StartAvatarSessionResult>(
          'startAvatarSession',
          { characterId },
          { singletonKey: `startAvatarSession:${characterId}` }
        );
        if (cancelled) return;

        const adapter = getAvatarAdapter(provider);
        session = await adapter.startSession({
          livekitUrl: room.livekitUrl,
          livekitToken: room.livekitToken,
          avatarIdentity: room.avatarIdentity,
          sessionId: room.sessionId,
          avatarProxyBaseURL: provider.proxyBaseURL,
          videoElement: videoRef.current!,
          audioElement: audioRef.current!,
          onError: (detail) => setError(detail)
        });
        if (cancelled) {
          await session.close();
          return;
        }
        convoRef.current = new Conversation({
          avatarSession: session,
          systemPrompt: buildSystemPrompt(name, personality),
          stt: getVoiceProvider('speech_to_text'),
          tts: getVoiceProvider('text_to_speech'),
          callbacks: {
            onStateChange: setState,
            onTranscript: (role, text) =>
              role === 'user' ? setUserText(text) : setAvatarText(text),
            onError: setError
          }
        });
        setConnecting(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setConnecting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      convoRef.current?.close();
      convoRef.current = null;
      void session?.close();
    };
  }, [name, characterId, personality]);

  const talkDisabled = connecting || state === 'thinking' || !!error;

  return (
    <div className="flex h-screen flex-col bg-neutral-950 p-3 pt-5">
      <div className="relative flex-1 overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <audio ref={audioRef} autoPlay />

        <button
          type="button"
          onClick={onExit}
          className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
        >
          <IconPhoneOff size={16} />
          End call
        </button>

        {connecting && !error && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="text-xs text-white/70">Connecting to {name}…</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 grid place-items-center p-8 text-center">
            <div className="flex max-w-sm flex-col gap-3">
              <p className="text-sm text-red-400">{error}</p>
              <BackButton onExit={onExit} />
            </div>
          </div>
        )}

        {(userText || avatarText) && (
          <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-1 px-6 text-center">
            {userText && <p className="text-[11px] text-white/50">You: {userText}</p>}
            {avatarText && <p className="text-sm text-white/90">{avatarText}</p>}
          </div>
        )}

        {!error && (
          <div className="absolute inset-x-0 bottom-5 flex flex-col items-center gap-2">
            <button
              type="button"
              disabled={talkDisabled}
              onPointerDown={() => void convoRef.current?.startListening()}
              onPointerUp={() => void convoRef.current?.stopListening()}
              onPointerLeave={() => void convoRef.current?.stopListening()}
              className={`flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-colors disabled:opacity-40 ${
                state === 'listening'
                  ? 'bg-red-500 text-white'
                  : 'bg-white/90 text-neutral-900 hover:bg-white'
              }`}
            >
              <IconMicrophone size={18} />
              {STATE_LABEL[state]}
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-center pt-2">
        <BackButton onExit={onExit} subtle />
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-screen place-items-center bg-neutral-950 p-8 text-center">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}

function BackButton({ onExit, subtle }: { onExit: () => void; subtle?: boolean }) {
  return (
    <button
      type="button"
      onClick={onExit}
      className={
        subtle
          ? 'text-xs text-white/40 underline-offset-2 hover:underline'
          : 'rounded-full border border-white/30 px-4 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10'
      }
    >
      Back to characters
    </button>
  );
}

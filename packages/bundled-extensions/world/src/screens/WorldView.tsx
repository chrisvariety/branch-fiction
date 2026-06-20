import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import {
  ReactorProvider,
  ReactorView,
  useReactor,
  useReactorMessage
} from '@reactor-team/js-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchSeedImageBlob, getReactorJwt, MODEL_NAMES } from '@/lib/reactor';
import type { PrepareWorldResult } from '@/worker/prepare-world';

import { HeliosControls } from './controls/HeliosControls';
import { LingbotControls } from './controls/LingbotControls';

// A long silence after the stream starts means delivery is blocked (often a VPN or Private Relay).
const STALL_TIMEOUT_MS = 10000;

export function WorldView({
  world,
  onExit
}: {
  world: PrepareWorldResult;
  onExit: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ReactorProvider
      key={attempt}
      modelName={MODEL_NAMES[world.model]}
      getJwt={getReactorJwt}
      connectOptions={{ autoConnect: true }}
    >
      <WorldStage
        world={world}
        onExit={onExit}
        onReconnect={() => setAttempt((a) => a + 1)}
      />
    </ReactorProvider>
  );
}

type Phase = 'connecting' | 'conditioning' | 'starting' | 'live' | 'error';

interface ReactorMsg {
  type: string;
  data?: {
    started?: boolean;
    has_prompt?: boolean;
    has_image?: boolean;
    command?: string;
    reason?: string;
    action?: string;
    message?: string;
  };
}

function WorldStage({
  world,
  onExit,
  onReconnect
}: {
  world: PrepareWorldResult;
  onExit: () => void;
  onReconnect: () => void;
}) {
  const { status, sendCommand, uploadFile } = useReactor((s) => ({
    status: s.status,
    sendCommand: s.sendCommand,
    uploadFile: s.uploadFile
  }));

  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [terminated, setTerminated] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState(world.prompt);

  const conditionedRef = useRef(false);
  const startSentRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const seedSrc = transformImageUrl(world.seedImageUrl);

  // Force-mute to satisfy WKWebView autoplay; the playing/pause listeners own `playing`.
  const tryPlay = useCallback(async () => {
    const video = stageRef.current?.querySelector('video');
    if (!video) return;
    video.muted = true;
    // iOS gates muted autoplay on the attribute, not the property, unlike desktop.
    video.setAttribute('muted', '');
    // Without playsinline, WKWebView forces fullscreen and pause-on-dismiss resets us.
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    try {
      await video.play();
      setPlaying(true);
    } catch {
      // ReactorView re-attached the stream mid-play; the retry effect recovers.
    }
  }, []);

  // Events are the source of truth: start only once conditions_ready confirms commit.
  useReactorMessage((msg: ReactorMsg) => {
    if (msg.type === 'moderation' && msg.data?.action === 'terminate') {
      setTerminated(
        msg.data?.message ?? 'Your session ended due to a content policy violation.'
      );
      setPlaying(false);
      setStarted(false);
      return;
    }
    if (msg.type === 'command_error') {
      setError(
        `${msg.data?.command ?? 'command'} failed: ${msg.data?.reason ?? 'unknown'}`
      );
      setPhase('error');
      return;
    }
    if (
      msg.type === 'conditions_ready' &&
      msg.data?.has_prompt &&
      msg.data?.has_image &&
      !startSentRef.current
    ) {
      startSentRef.current = true;
      setPhase('starting');
      sendCommand('start', {}).catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
      return;
    }
    if (
      (msg.type === 'state' && msg.data?.started) ||
      msg.type === 'generation_started'
    ) {
      setStarted(true);
      setPhase('live');
    }
  });

  const condition = useCallback(async () => {
    setPhase('conditioning');
    const blob = await fetchSeedImageBlob(world.seedImageUrl);
    const ref = await uploadFile(blob, { name: 'seed.png' });
    if (world.model === 'helios') {
      await sendCommand('set_conditioning', { prompt: world.prompt, image: ref });
    } else {
      await sendCommand('set_image', { image: ref });
      await sendCommand('set_prompt', { prompt: world.prompt });
    }
  }, [world, sendCommand, uploadFile]);

  useEffect(() => {
    if (status !== 'ready' || conditionedRef.current) return;
    conditionedRef.current = true;
    condition().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    });
  }, [status, condition]);

  // Reconcile `playing` with the element's real state, whoever wins the play race.
  useEffect(() => {
    const video = stageRef.current?.querySelector('video');
    if (!video) return;
    const sync = () => setPlaying(!video.paused);
    video.addEventListener('playing', sync);
    video.addEventListener('pause', sync);
    return () => {
      video.removeEventListener('playing', sync);
      video.removeEventListener('pause', sync);
    };
  }, []);

  // A single play() can be aborted by a stream re-attach; retry until it sticks.
  useEffect(() => {
    if (!started || playing) return;
    void tryPlay();
    const id = setInterval(() => void tryPlay(), 800);
    return () => clearInterval(id);
  }, [started, playing, tryPlay]);

  // Flag a stall when the stream has started but no frame plays within the grace window.
  useEffect(() => {
    if (!started || playing) {
      setStalled(false);
      return;
    }
    const id = setTimeout(() => setStalled(true), STALL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [started, playing]);

  return (
    <div className="flex h-screen items-center justify-center bg-background p-3">
      <div className="relative flex w-full max-w-[calc((100vh-1.5rem)*16/9)] flex-col">
        <div
          ref={stageRef}
          className="relative aspect-video max-h-full w-full flex-none overflow-hidden rounded-2xl bg-black"
        >
          <ReactorView className="h-full w-full" videoObjectFit="cover" />
          <button
            aria-label="Exit"
            className="absolute top-3 right-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-black/40 text-lg leading-none text-white/80 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
            onClick={onExit}
          >
            ✕
          </button>
          <img
            src={seedSrc}
            alt=""
            aria-hidden
            className={`pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl transition-opacity duration-1000 ${
              playing ? 'opacity-0' : 'opacity-100'
            }`}
          />

          {!playing && (
            <div className="absolute inset-0 grid place-items-center px-8 text-center">
              {terminated ? (
                <div className="flex max-w-sm flex-col items-center gap-3">
                  <span className="text-sm text-white/90 drop-shadow">{terminated}</span>
                  <div className="flex gap-2">
                    <button
                      className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
                      onClick={onReconnect}
                    >
                      Reconnect
                    </button>
                    <button
                      className="rounded-full border border-white/30 px-4 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
                      onClick={onExit}
                    >
                      Exit
                    </button>
                  </div>
                </div>
              ) : error ? (
                <span className="text-sm text-red-400">{error}</span>
              ) : stalled ? (
                <div className="flex max-w-sm flex-col items-center gap-3">
                  <span className="text-sm font-medium text-white/90 drop-shadow">
                    Your world isn’t loading
                  </span>
                  <span className="text-xs text-white/70 drop-shadow">
                    A VPN or iCloud Private Relay can block the video stream. Try turning
                    those off, then reconnect.
                  </span>
                  <div className="flex gap-2">
                    <button
                      className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
                      onClick={onReconnect}
                    >
                      Reconnect
                    </button>
                    <button
                      className="rounded-full border border-white/30 px-4 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
                      onClick={onExit}
                    >
                      Exit
                    </button>
                  </div>
                </div>
              ) : started ? (
                <button
                  className="text-sm font-medium text-white drop-shadow"
                  onClick={() => void tryPlay()}
                >
                  ▶ Tap to enter your world
                </button>
              ) : (
                <span className="text-sm text-white/80 drop-shadow">
                  {statusMessage(status, phase)}
                </span>
              )}
            </div>
          )}
        </div>

        {playing &&
          (world.model === 'helios' ? (
            <HeliosControls
              sendCommand={sendCommand}
              currentPrompt={currentPrompt}
              suggestedActions={world.suggestedActions}
              onEvolved={setCurrentPrompt}
            />
          ) : (
            <LingbotControls sendCommand={sendCommand} />
          ))}
      </div>
    </div>
  );
}

function statusMessage(status: string, phase: Phase): string {
  if (status === 'connecting') return 'Connecting…';
  if (status === 'waiting') return 'Waiting for GPU…';
  if (phase === 'conditioning') return 'Generating your world…';
  if (phase === 'starting') return 'Starting stream…';
  return 'Generating your world…';
}

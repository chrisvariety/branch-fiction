import {
  ReactorProvider,
  ReactorView,
  useReactor,
  useReactorMessage
} from '@reactor-team/js-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import { transformImageUrl } from '@/lib/media/transform-url';
import { fetchSeedImageBlob, getReactorJwt, MODEL_NAMES } from '@/lib/reactor';
import type { PrepareWorldResult } from '@/worker/prepare-world';

import { HeliosControls } from './controls/HeliosControls';
import { LingbotControls } from './controls/LingbotControls';

export function WorldView({
  world,
  onExit
}: {
  world: PrepareWorldResult;
  onExit: () => void;
}) {
  return (
    <ReactorProvider
      modelName={MODEL_NAMES[world.model]}
      getJwt={getReactorJwt}
      connectOptions={{ autoConnect: true }}
    >
      <WorldStage world={world} onExit={onExit} />
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
  };
}

function WorldStage({
  world,
  onExit
}: {
  world: PrepareWorldResult;
  onExit: () => void;
}) {
  const { status, sendCommand, uploadFile } = useReactor((s) => ({
    status: s.status,
    sendCommand: s.sendCommand,
    uploadFile: s.uploadFile
  }));

  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState(world.prompt);

  const conditionedRef = useRef(false);
  const startSentRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const seedSrc = transformImageUrl(world.seedImageUrl);

  // WKWebView blocks programmatic autoplay; force-mute and play the element.
  const tryPlay = useCallback(async () => {
    const video = stageRef.current?.querySelector('video');
    if (!video) return;
    video.muted = true;
    try {
      await video.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, []);

  // Events are the source of truth: start only once conditions_ready confirms commit.
  useReactorMessage((msg: ReactorMsg) => {
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

  useEffect(() => {
    if (started) void tryPlay();
  }, [started, tryPlay]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="min-w-0">
          <span className="text-sm font-medium capitalize">{world.model} world</span>
          <span className="ml-2 text-xs opacity-60">{phaseLabel(status, phase)}</span>
        </div>
        <button className="rounded-md border px-3 py-1 text-sm" onClick={onExit}>
          Exit
        </button>
      </header>

      <div ref={stageRef} className="relative flex-1 bg-black">
        <ReactorView className="h-full w-full" videoObjectFit="contain" />
        <img
          src={seedSrc}
          alt=""
          aria-hidden
          className={`pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl transition-opacity duration-1000 ${
            playing ? 'opacity-0' : 'opacity-100'
          }`}
        />
        {!started && (
          <div className="absolute inset-0 grid place-items-center px-8 text-center text-sm text-white/80">
            {error ? (
              <span className="text-red-400">{error}</span>
            ) : (
              'Generating your world…'
            )}
          </div>
        )}
        {started && !playing && (
          <button
            className="absolute inset-0 grid place-items-center bg-black/40 text-sm font-medium text-white"
            onClick={() => void tryPlay()}
          >
            ▶ Tap to enter your world
          </button>
        )}
      </div>

      {started &&
        (world.model === 'helios' ? (
          <HeliosControls
            sendCommand={sendCommand}
            currentPrompt={currentPrompt}
            onEvolved={setCurrentPrompt}
          />
        ) : (
          <LingbotControls sendCommand={sendCommand} />
        ))}
    </div>
  );
}

function phaseLabel(status: string, phase: Phase): string {
  if (phase === 'error') return 'error';
  if (status === 'connecting') return 'connecting…';
  if (status === 'waiting') return 'waiting for GPU…';
  if (phase === 'conditioning') return 'sending scene…';
  if (phase === 'starting') return 'starting stream…';
  if (phase === 'live') return 'live';
  return status;
}

import {
  ReactorProvider,
  ReactorView,
  useReactor,
  useReactorMessage
} from '@reactor-team/js-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ActiveWorld } from '@/lib/db/types';
import {
  fetchSeedImageBlob,
  getReactorJwt,
  MODEL_NAMES,
  type ReactorSdkModel
} from '@/lib/reactor';

import { HeliosControls } from './controls/HeliosControls';
import { LingbotControls } from './controls/LingbotControls';
import { useStageVideo } from './stage/use-stage-video';
import { StageError, StageMessage, StagePrompt, WorldStage } from './stage/WorldStage';

type ReactorWorld = ActiveWorld & { model: ReactorSdkModel };

export function ReactorWorldView({
  world,
  onExit
}: {
  world: ReactorWorld;
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
      <ReactorStage
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

function ReactorStage({
  world,
  onExit,
  onReconnect
}: {
  world: ReactorWorld;
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
  const [currentPrompt, setCurrentPrompt] = useState(world.prompt);

  const conditionedRef = useRef(false);
  const startSentRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const { playing, stalled, tryPlay } = useStageVideo(stageRef, started);

  // Events are the source of truth: start only once conditions_ready confirms commit.
  useReactorMessage((msg: ReactorMsg) => {
    if (msg.type === 'moderation' && msg.data?.action === 'terminate') {
      setTerminated(
        msg.data?.message ?? 'Your session ended due to a content policy violation.'
      );
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

  return (
    <WorldStage
      stageRef={stageRef}
      seedImageUrl={world.seedImageUrl}
      playing={playing}
      onExit={onExit}
      video={<ReactorView className="h-full w-full" videoObjectFit="cover" />}
      overlay={
        terminated ? (
          <StagePrompt
            title={terminated}
            actions={[
              { label: 'Reconnect', onClick: onReconnect, primary: true },
              { label: 'Exit', onClick: onExit }
            ]}
          />
        ) : error ? (
          <StageError>{error}</StageError>
        ) : stalled ? (
          <StagePrompt
            title="Your world isn’t loading"
            detail="A VPN or iCloud Private Relay can block the video stream. Try turning those off, then reconnect."
            actions={[
              { label: 'Reconnect', onClick: onReconnect, primary: true },
              { label: 'Exit', onClick: onExit }
            ]}
          />
        ) : started ? (
          <button
            className="text-sm font-medium text-white drop-shadow"
            onClick={() => void tryPlay()}
          >
            ▶ Tap to enter your world
          </button>
        ) : (
          <StageMessage>{statusMessage(status, phase)}</StageMessage>
        )
      }
      controls={
        playing &&
        (world.model === 'helios' ? (
          <HeliosControls
            sendCommand={sendCommand}
            currentPrompt={currentPrompt}
            suggestedActions={world.suggestedActions}
            onEvolved={setCurrentPrompt}
          />
        ) : (
          <LingbotControls sendCommand={sendCommand} />
        ))
      }
    />
  );
}

function statusMessage(status: string, phase: Phase): string {
  if (status === 'connecting') return 'Connecting…';
  if (status === 'waiting') return 'Waiting for GPU…';
  if (phase === 'conditioning') return 'Generating your world…';
  if (phase === 'starting') return 'Starting stream…';
  return 'Generating your world…';
}

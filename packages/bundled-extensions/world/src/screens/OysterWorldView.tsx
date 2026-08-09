import { HappyOysterActionError } from '@reactor-models/happy-oyster';
import {
  HappyOysterProvider,
  HappyOysterVideo,
  useHappyOyster,
  useHappyOysterTravelError,
  useHappyOysterTravelStatus
} from '@reactor-models/happy-oyster/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { saveEncryptedWorldId } from '@/iframe/db/worlds';
import type { ActiveWorld, OysterModel } from '@/lib/db/types';
import { getReactorJwt, oysterMode, prepareFirstFrame } from '@/lib/reactor';

import { OysterAdventureControls } from './controls/OysterAdventureControls';
import { OysterDirectingControls } from './controls/OysterDirectingControls';
import { useStageVideo } from './stage/use-stage-video';
import { StageError, StageMessage, StagePrompt, WorldStage } from './stage/WorldStage';

type OysterWorld = ActiveWorld & { model: OysterModel };

export function OysterWorldView({
  world,
  onExit
}: {
  world: OysterWorld;
  onExit: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <HappyOysterProvider
      key={attempt}
      mode={oysterMode(world.model)}
      jwt={getReactorJwt}
      autoConnect
    >
      <OysterStage
        world={world}
        onExit={onExit}
        onReconnect={() => setAttempt((a) => a + 1)}
      />
    </HappyOysterProvider>
  );
}

type Stage = 'connecting' | 'building' | 'starting' | 'live' | 'ended' | 'error';

function OysterStage({
  world,
  onExit,
  onReconnect
}: {
  world: OysterWorld;
  onExit: () => void;
  onReconnect: () => void;
}) {
  const oyster = useHappyOyster();
  const { phase, streaming, travelState, maxExperienceTimeSec } = oyster;

  const [stage, setStage] = useState<Stage>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const boundRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const { playing, stalled, tryPlay } = useStageVideo(stageRef, streaming);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setStage('error');
  }, []);

  const bind = useCallback(async () => {
    setStage('building');
    let attached = false;
    if (world.encryptedWorldId) {
      try {
        await oyster.attachWorld(world.encryptedWorldId);
        attached = true;
      } catch (e) {
        if (!isUnreachableWorld(e)) throw e;
      }
    }
    if (!attached) {
      const firstFrameImage = await prepareFirstFrame(world.seedImageUrl);
      const state = await oyster.createWorld(
        world.model === 'oyster-adventure'
          ? { prompt: world.prompt, firstFrameImage, perspective: 'third_person' }
          : {
              prompt: world.prompt,
              firstFrameImage,
              resolution: '720p',
              layout: 'Stable',
              narrative: 'Normal'
            }
      );
      if (state.encrypted_world_id) {
        await saveEncryptedWorldId(world.worldId, state.encrypted_world_id);
      }
    }
    setStage('starting');
    await oyster.startTravel();
    setStage('live');
  }, [world, oyster]);

  useEffect(() => {
    if (phase !== 'connected' || boundRef.current) return;
    boundRef.current = true;
    bind().catch(fail);
  }, [phase, bind, fail]);

  useHappyOysterTravelStatus((status) => {
    if (status === 'completed') setStage('ended');
  });

  useHappyOysterTravelError(fail);

  // HappyOyster ends the travel on its own clock, so count down to it rather than guess.
  useEffect(() => {
    if (!streaming || maxExperienceTimeSec === null) {
      setRemaining(null);
      return;
    }
    const deadline = Date.now() + maxExperienceTimeSec * 1000;
    const tick = () =>
      setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [streaming, maxExperienceTimeSec]);

  const travelAgain = useCallback(() => {
    setStage('starting');
    oyster.startTravel().then(() => setStage('live'), fail);
  }, [oyster, fail]);

  const adventureVerbs = [
    ...(travelState?.character_actions ?? []),
    ...(travelState?.environment_actions ?? [])
  ];

  return (
    <WorldStage
      stageRef={stageRef}
      seedImageUrl={world.seedImageUrl}
      playing={playing && stage !== 'ended'}
      onExit={onExit}
      video={<HappyOysterVideo className="h-full w-full object-cover" />}
      badge={remaining !== null && playing && <Countdown seconds={remaining} />}
      overlay={
        error ? (
          <StageError>{error}</StageError>
        ) : stage === 'ended' ? (
          <StagePrompt
            title="Your travel has ended"
            detail="The world is saved — you can travel through it again, or come back to it later."
            actions={[
              { label: 'Travel again', onClick: travelAgain, primary: true },
              { label: 'Exit', onClick: onExit }
            ]}
          />
        ) : stalled ? (
          <StagePrompt
            title="Your world isn’t loading"
            detail="A VPN or iCloud Private Relay can block the video stream. Try turning those off, then reconnect."
            actions={[
              { label: 'Reconnect', onClick: onReconnect, primary: true },
              { label: 'Exit', onClick: onExit }
            ]}
          />
        ) : streaming ? (
          <button
            className="text-sm font-medium text-white drop-shadow"
            onClick={() => void tryPlay()}
          >
            ▶ Tap to enter your world
          </button>
        ) : (
          <StageMessage>
            {statusMessage(stage, Boolean(world.encryptedWorldId))}
          </StageMessage>
        )
      }
      controls={
        playing &&
        stage === 'live' &&
        (world.model === 'oyster-adventure' ? (
          <OysterAdventureControls
            move={oyster.move}
            look={oyster.look}
            interact={oyster.interact}
            release={oyster.release}
            verbs={adventureVerbs.length > 0 ? adventureVerbs : world.suggestedActions}
          />
        ) : (
          <OysterDirectingControls
            instruct={oyster.instruct}
            worldPrompt={world.prompt}
            suggestedActions={world.suggestedActions}
            instructions={travelState?.user_instructions ?? []}
          />
        ))
      }
    />
  );
}

function isUnreachableWorld(error: unknown): boolean {
  return (
    error instanceof HappyOysterActionError &&
    (error.code === '403001' || error.code === 'MODE_MISMATCH')
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <span className="rounded-full border border-white/20 bg-black/40 px-3 py-1 font-mono text-xs text-white/80 backdrop-blur-sm">
      {mm}:{ss}
    </span>
  );
}

function statusMessage(stage: Stage, reattaching: boolean): string {
  if (stage === 'connecting') return 'Connecting…';
  if (stage === 'building')
    return reattaching ? 'Reopening your world…' : 'Building your world…';
  if (stage === 'starting') return 'Starting your travel…';
  return 'Building your world…';
}

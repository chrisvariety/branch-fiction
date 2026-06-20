import { useLocalParticipant } from '@livekit/components-react';
import {
  AvatarCall,
  AvatarVideo,
  type SessionCredentials,
  useAvatarSession
} from '@runwayml/avatars-react';
import { IconMicrophone, IconMicrophoneOff, IconPhoneOff } from '@tabler/icons-react';
import { useCallback, useRef, useState } from 'react';

import { setScenarioDocument } from '@/iframe/db/models/avatar-scenario/update-scenario';
import type { AvatarScenario } from '@/lib/db/types';
import {
  connectAvatarSession,
  RUNWAY_API_BASE,
  type ScenarioSession
} from '@/lib/runway';

export function AvatarView({
  avatarId,
  characterName,
  scenario,
  initialCredentials,
  onExit
}: {
  avatarId: string;
  characterName: string;
  scenario: AvatarScenario | null;
  initialCredentials: SessionCredentials;
  onExit: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  // The first session was already created during scenario preflight; reuse it once.
  const pendingCredentials = useRef<SessionCredentials | null>(initialCredentials);

  // Survives reconnects so a freshly created document is reused instead of duplicated.
  const docRef = useRef<{ id: string | null; hash: string | null }>({
    id: scenario?.runwayDocumentId ?? null,
    hash: scenario?.runwayDocumentHash ?? null
  });

  const connect = useCallback(
    (id: string) => {
      if (pendingCredentials.current) {
        const credentials = pendingCredentials.current;
        pendingCredentials.current = null;
        return Promise.resolve(credentials);
      }

      const session: ScenarioSession | undefined = scenario
        ? {
            personality: scenario.personality,
            startScript: scenario.startScript,
            documentName: `${characterName} — ${scenario.label}`,
            knowledge: scenario.knowledge,
            knowledgeHash: scenario.knowledgeHash,
            existingDocumentId: docRef.current.id,
            existingDocumentHash: docRef.current.hash,
            onDocumentReady: (documentId, hash) => {
              docRef.current = { id: documentId, hash };
              return setScenarioDocument(scenario.id, documentId, hash).then(
                () => undefined
              );
            }
          }
        : undefined;
      return connectAvatarSession(id, session);
    },
    [scenario, characterName]
  );

  return (
    <div className="flex h-screen flex-col bg-background p-3 pt-5">
      <div className="relative flex-1 overflow-hidden rounded-2xl bg-card">
        {error ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="flex max-w-sm flex-col gap-3">
              <p className="text-sm text-destructive">{error}</p>
              <button
                type="button"
                onClick={onExit}
                className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Back to characters
              </button>
            </div>
          </div>
        ) : (
          <AvatarCall
            key={avatarId}
            avatarId={avatarId}
            connect={connect}
            baseUrl={RUNWAY_API_BASE}
            video={false}
            onEnd={onExit}
            onError={(e) => setError(e.message)}
            className="h-full w-full justify-center"
          >
            <AvatarVideo className="aspect-video flex-none sm:aspect-auto sm:flex-1" />
            <CallControls />
          </AvatarCall>
        )}
      </div>
    </div>
  );
}

// Runway's ControlBar enumerates video inputs with permission, prompting for camera on iOS.
function CallControls() {
  const { state, end } = useAvatarSession();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();

  if (state !== 'active') return null;

  return (
    <div className="relative z-10 flex shrink-0 justify-center gap-3 py-4 sm:absolute sm:inset-x-0 sm:bottom-4 sm:py-0">
      <button
        type="button"
        aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
        onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        className="grid h-11 w-11 place-items-center rounded-full border border-border bg-background/70 text-foreground backdrop-blur-sm transition-colors hover:bg-background"
      >
        {isMicrophoneEnabled ? (
          <IconMicrophone size={20} />
        ) : (
          <IconMicrophoneOff size={20} className="text-destructive" />
        )}
      </button>
      <button
        type="button"
        aria-label="End call"
        onClick={end}
        className="grid h-11 w-11 place-items-center rounded-full bg-destructive text-white backdrop-blur-sm transition-colors hover:bg-destructive/90"
      >
        <IconPhoneOff size={20} />
      </button>
    </div>
  );
}

import {
  AvatarCall,
  AvatarVideo,
  ControlBar,
  type SessionCredentials
} from '@runwayml/avatars-react';
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
    <div className="flex h-screen flex-col bg-neutral-950 p-3 pt-5">
      <div className="relative flex-1 overflow-hidden rounded-2xl bg-black">
        {error ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="flex max-w-sm flex-col gap-3">
              <p className="text-sm text-red-400">{error}</p>
              <button
                type="button"
                onClick={onExit}
                className="rounded-full border border-white/30 px-4 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
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
            className="h-full w-full"
          >
            <AvatarVideo />
            <ControlBar showCamera={false} />
          </AvatarCall>
        )}
      </div>
    </div>
  );
}

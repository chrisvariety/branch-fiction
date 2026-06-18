import type { SessionCredentials } from '@runwayml/avatars-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { PickableCharacter } from '@/iframe/db/entities';
import { getScenarios } from '@/iframe/db/models/avatar-scenario/get-scenarios';
import {
  setScenarioDocument,
  setScenarioScript
} from '@/iframe/db/models/avatar-scenario/update-scenario';
import type { AvatarScenario } from '@/lib/db/types';
import {
  connectAvatarSession,
  isContentRejected,
  type ScenarioSession
} from '@/lib/runway';
import { scenarioModeInfo } from '@/lib/scenarios';

function cardClasses(selected: boolean) {
  return `flex flex-col gap-1.5 border bg-card p-3 text-left transition-colors ${
    selected
      ? 'border-primary ring-1 ring-primary'
      : 'border-border hover:border-muted-foreground/40'
  }`;
}

export function SelectScenario({
  bookId,
  character,
  avatarId,
  onStarted,
  onBack
}: {
  bookId: string;
  character: PickableCharacter;
  avatarId: string;
  onStarted: (credentials: SessionCredentials, scenario: AvatarScenario | null) => void;
  onBack: () => void;
}) {
  const scenarios = useQuery({
    queryKey: ['scenarios', bookId, character.id],
    queryFn: () => getScenarios(bookId, character.id)
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scriptDraft, setScriptDraft] = useState('');
  const [personalityDraft, setPersonalityDraft] = useState('');
  const [showPersonality, setShowPersonality] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ rejected: boolean; message: string } | null>(null);

  const docRef = useRef<{ id: string | null; hash: string | null }>({
    id: null,
    hash: null
  });

  const rows = scenarios.data ?? [];
  const selected = useMemo(
    () => rows.find((s) => s.id === selectedId) ?? null,
    [rows, selectedId]
  );

  useEffect(() => {
    if (!selectedId && rows.length > 0) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setScriptDraft(selected.startScript);
    setPersonalityDraft(selected.personality);
    setShowPersonality(false);
    setError(null);
    docRef.current = {
      id: selected.runwayDocumentId,
      hash: selected.runwayDocumentHash
    };
  }, [selected]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      if (!selected) {
        const credentials = await connectAvatarSession(avatarId);
        onStarted(credentials, null);
        return;
      }

      const script = scriptDraft.trim();
      const personality = personalityDraft.trim();
      if (script !== selected.startScript || personality !== selected.personality) {
        await setScenarioScript(selected.id, script, personality);
      }

      const session: ScenarioSession = {
        personality,
        startScript: script,
        documentName: `${character.name} — ${selected.label}`,
        knowledge: selected.knowledge,
        knowledgeHash: selected.knowledgeHash,
        existingDocumentId: docRef.current.id,
        existingDocumentHash: docRef.current.hash,
        onDocumentReady: (documentId, hash) => {
          docRef.current = { id: documentId, hash };
          return setScenarioDocument(selected.id, documentId, hash).then(() => undefined);
        }
      };

      const credentials = await connectAvatarSession(avatarId, session);
      onStarted(credentials, {
        ...selected,
        startScript: script,
        personality,
        runwayDocumentId: docRef.current.id,
        runwayDocumentHash: docRef.current.hash
      });
    } catch (e) {
      setError({
        rejected: isContentRejected(e),
        message: e instanceof Error ? e.message : String(e)
      });
      setShowPersonality(true);
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-10 pt-10 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          {character.name}
        </p>
        <h1 className="font-serif text-xl tracking-tight text-balance">
          How do you want to begin?
        </h1>
        <div className="h-px w-12 bg-border" />
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Each opening sets a different kind of conversation. Pick one, tweak the first
          line if you like, then start the call.
        </p>
      </div>

      {scenarios.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading openings…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="max-w-sm text-xs text-muted-foreground">
            No openings have been generated for this character yet. You can still start a
            call with the avatar’s default personality.
          </p>
          {error && <p className="max-w-sm text-xs text-destructive">{error.message}</p>}
          <button
            type="button"
            disabled={starting}
            onClick={() => void start()}
            className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {starting ? 'Starting…' : 'Start call'}
          </button>
        </div>
      ) : (
        <div className="flex w-full max-w-2xl flex-col gap-5">
          <div
            role="radiogroup"
            aria-label="Conversation opening"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {rows.map((s) => {
              const info = scenarioModeInfo(s.mode);
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedId === s.id}
                  className={cardClasses(selectedId === s.id)}
                  onClick={() => setSelectedId(s.id)}
                >
                  <span className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                    {info?.title ?? s.mode}
                  </span>
                  <span className="font-serif text-base leading-tight">{s.label}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {s.tagline}
                  </span>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="start-script"
                className="text-xs font-medium text-muted-foreground"
              >
                Opening line
              </label>
              <textarea
                id="start-script"
                value={scriptDraft}
                onChange={(e) => setScriptDraft(e.target.value)}
                className="h-32 w-full resize-none border border-input bg-background p-3 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none"
              />
              <span className="text-right text-[10px] text-muted-foreground">
                {scriptDraft.length} / 1500
              </span>

              {showPersonality ? (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="personality"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Personality
                  </label>
                  <textarea
                    id="personality"
                    value={personalityDraft}
                    onChange={(e) => setPersonalityDraft(e.target.value)}
                    className="h-48 w-full resize-none border border-input bg-background p-3 text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none"
                  />
                  <span className="text-right text-[10px] text-muted-foreground">
                    {personalityDraft.length} / 4000
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPersonality(true)}
                  className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Edit personality
                </button>
              )}
            </div>
          )}

          {error?.rejected ? (
            <div className="flex flex-col gap-1.5 border border-destructive/40 bg-destructive/5 p-3 text-xs text-foreground">
              <p className="font-medium text-destructive">
                Runway’s safety filter blocked this opening.
              </p>
              <p className="leading-relaxed text-muted-foreground">
                It won’t accept the opening line or personality as written. This usually
                clears up if you:
              </p>
              <ul className="list-disc pl-4 leading-relaxed text-muted-foreground">
                <li>use first names only — no surnames or full names</li>
                <li>soften the most intense or violent phrasing</li>
                <li>remove any line that names the character themselves</li>
              </ul>
              <p className="leading-relaxed text-muted-foreground">
                Edit the text above and start again.
              </p>
            </div>
          ) : (
            error && <p className="text-xs text-destructive">{error.message}</p>
          )}

          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="border border-border px-4 py-2 text-sm font-medium"
              onClick={onBack}
            >
              Back
            </button>
            <button
              type="button"
              disabled={!selected || !scriptDraft.trim() || starting}
              onClick={() => void start()}
              className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {starting ? 'Starting…' : 'Start call'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

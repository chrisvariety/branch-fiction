import { useEffect, useRef, useState } from 'react';

import type { EvolveHeliosPromptResult } from '@/worker/evolve-helios-prompt';

type SendCommand = (command: string, data: unknown) => Promise<void>;

const ACTIONS_REVEAL_DELAY_MS = 10000;

export function HeliosControls({
  sendCommand,
  currentPrompt,
  suggestedActions,
  onEvolved
}: {
  sendCommand: SendCommand;
  currentPrompt: string;
  suggestedActions: string[];
  onEvolved: (prompt: string) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState(suggestedActions);
  const [actionsVisible, setActionsVisible] = useState(true);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    []
  );

  async function evolve(intent?: string) {
    const userIntent = (intent ?? text).trim();
    if (!userIntent || busy) return;
    setText(userIntent);
    setBusy(true);
    setError(null);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    setActionsVisible(false);
    try {
      const { prompt, suggestedActions: nextActions } =
        await window.extensionSDK.worker.spawn<EvolveHeliosPromptResult>(
          'evolveHeliosPrompt',
          { currentPrompt, userIntent }
        );
      await sendCommand('set_prompt', { prompt });
      onEvolved(prompt);
      if (nextActions.length > 0) setActions(nextActions);
      setText('');
      revealTimer.current = setTimeout(() => {
        setActionsVisible(true);
      }, ACTIONS_REVEAL_DELAY_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActionsVisible(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-center px-4 pt-3 sm:absolute sm:inset-x-0 sm:bottom-4 sm:pt-0">
      <div className="w-full max-w-2xl">
        {(error || busy) && (
          <div className="mb-1 text-center text-xs drop-shadow">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : (
              <span className="text-muted-foreground">Evolving the scene…</span>
            )}
          </div>
        )}
        {actions.length > 0 && actionsVisible && (
          <div className="mb-2 flex animate-[fadeIn_300ms_ease-out] flex-wrap justify-center gap-1.5">
            {actions.map((action) => (
              <button
                key={action}
                className="rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:hover:bg-card/70"
                disabled={busy}
                onClick={() => void evolve(action)}
              >
                {action}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-full border border-border bg-card/70 py-1 pr-1 pl-3 backdrop-blur-md">
          <input
            type="text"
            className="h-9 flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
            value={text}
            placeholder="Evolve the scene — what should change?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void evolve();
              }
            }}
          />
          <button
            aria-label="Evolve the scene"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={!text.trim() || busy}
            onClick={() => void evolve()}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

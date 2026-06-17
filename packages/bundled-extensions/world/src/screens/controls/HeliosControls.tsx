import { useState } from 'react';

import type { EvolveHeliosPromptResult } from '@/worker/evolve-helios-prompt';

type SendCommand = (command: string, data: unknown) => Promise<void>;

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

  async function evolve(intent?: string) {
    const userIntent = (intent ?? text).trim();
    if (!userIntent || busy) return;
    setText(userIntent);
    setBusy(true);
    setError(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div className="w-full max-w-2xl">
        {(error || busy) && (
          <div className="mb-1 text-center text-xs drop-shadow">
            {error ? (
              <span className="text-red-400">{error}</span>
            ) : (
              <span className="text-white/80">Evolving the scene…</span>
            )}
          </div>
        )}
        {actions.length > 0 && (
          <div className="mb-2 flex flex-wrap justify-center gap-1.5">
            {actions.map((action) => (
              <button
                key={action}
                className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-xs text-white/80 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-black/30"
                disabled={busy}
                onClick={() => void evolve(action)}
              >
                {action}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/30 py-1 pr-1 pl-3 backdrop-blur-md">
          <input
            type="text"
            className="h-9 flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none"
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
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
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

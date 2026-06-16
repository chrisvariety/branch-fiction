import { useState } from 'react';

import type { EvolveHeliosPromptResult } from '@/worker/evolve-helios-prompt';

type SendCommand = (command: string, data: unknown) => Promise<void>;

export function HeliosControls({
  sendCommand,
  currentPrompt,
  onEvolved
}: {
  sendCommand: SendCommand;
  currentPrompt: string;
  onEvolved: (prompt: string) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function evolve() {
    const userIntent = text.trim();
    if (!userIntent || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { prompt } = await window.extensionSDK.worker.spawn<EvolveHeliosPromptResult>(
        'evolveHeliosPrompt',
        { currentPrompt, userIntent }
      );
      await sendCommand('set_prompt', { prompt });
      onEvolved(prompt);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs opacity-60">
          {error ? (
            <span className="text-red-500">{error}</span>
          ) : busy ? (
            'Evolving the scene…'
          ) : (
            'Evolve the scene — type an intent (e.g. “breath of flame”); we weave it into the shot.'
          )}
        </span>
        <textarea
          className="min-h-[3rem] resize-none rounded-md border bg-transparent p-2 text-sm"
          value={text}
          placeholder="breath of flame"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void evolve();
            }
          }}
        />
      </label>
      <button
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        disabled={!text.trim() || busy}
        onClick={evolve}
      >
        Evolve
      </button>
    </div>
  );
}

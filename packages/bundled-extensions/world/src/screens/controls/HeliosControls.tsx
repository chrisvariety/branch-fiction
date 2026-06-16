import { useState } from 'react';

type SendCommand = (command: string, data: unknown) => Promise<void>;

export function HeliosControls({ sendCommand }: { sendCommand: SendCommand }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function evolve() {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await sendCommand('set_prompt', { prompt });
      setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs opacity-60">
          Evolve the scene — one new beat at a time (applies at the next chunk).
        </span>
        <textarea
          className="min-h-[3rem] resize-none rounded-md border bg-transparent p-2 text-sm"
          value={text}
          placeholder="The camera pushes in as she turns toward the doorway…"
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

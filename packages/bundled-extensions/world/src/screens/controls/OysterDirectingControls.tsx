import type { TravelInstruction } from '@reactor-models/happy-oyster';
import { useEffect, useRef, useState } from 'react';

import type { SuggestDirectionsResult } from '@/worker/suggest-directions';

const SCHEDULING_TIMEOUT_MS = 20000;

interface ScheduledDirection {
  instruction: string;
  startMs: number;
  endMs: number;
}

interface SentDirection {
  text: string;
  knownCount: number;
}

function upcomingDirections(
  instructions: TravelInstruction[],
  elapsedMs: number
): ScheduledDirection[] {
  return instructions
    .flatMap((i) =>
      i.relative_start_time_ms === null || !i.instruction
        ? []
        : [
            {
              instruction: i.instruction,
              startMs: i.relative_start_time_ms,
              endMs: i.relative_end_time_ms ?? i.relative_start_time_ms
            }
          ]
    )
    .filter((d) => d.endMs > elapsedMs)
    .sort((a, b) => a.startMs - b.startMs);
}

export function OysterDirectingControls({
  instruct,
  worldPrompt,
  suggestedActions,
  instructions
}: {
  instruct: (content: string) => Promise<{ accepted: boolean }>;
  worldPrompt: string;
  suggestedActions: string[];
  instructions: TravelInstruction[];
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState(suggestedActions);
  const [refreshing, setRefreshing] = useState(false);
  const [sent, setSent] = useState<SentDirection | null>(null);
  const startedAt = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const refreshId = useRef(0);

  useEffect(() => {
    const tick = () => setElapsedMs(Date.now() - startedAt.current);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Give up waiting if the runtime never publishes it
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(null), SCHEDULING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [sent]);

  const upcoming = upcomingDirections(instructions, elapsedMs);
  const next = upcoming[0] ?? null;
  const waitMs = next ? next.startMs - elapsedMs : 0;
  const queued = upcoming.filter((d) => d.startMs > elapsedMs).length;

  // A sent direction is unscheduled until the runtime publishes it, which lags the ack.
  const scheduling = sent && instructions.length <= sent.knownCount ? sent.text : null;

  // One beat at a time
  const showSuggestions =
    actions.length > 0 && queued === 0 && !busy && !refreshing && !scheduling;

  // The wait before a direction plays is free time to write the next set of options.
  async function refreshActions(latestDirection: string, priorDirections: string[]) {
    const id = ++refreshId.current;
    setRefreshing(true);
    try {
      const { suggestedActions: fresh } =
        await window.extensionSDK.worker.spawn<SuggestDirectionsResult>(
          'suggestDirections',
          { worldPrompt, priorDirections, latestDirection }
        );
      if (id === refreshId.current && fresh.length > 0) setActions(fresh);
    } catch {
      // A failed refresh keeps the previous set
    } finally {
      if (id === refreshId.current) setRefreshing(false);
    }
  }

  async function send(content?: string) {
    const direction = (content ?? text).trim();
    if (!direction || busy) return;
    const priorDirections = instructions
      .map((i) => i.instruction)
      .filter((i): i is string => Boolean(i));
    setBusy(true);
    setError(null);
    try {
      const { accepted } = await instruct(direction);
      if (accepted) {
        setText('');
        setSent({ text: direction, knownCount: instructions.length });
        void refreshActions(direction, priorDirections);
      } else {
        setError('That direction was not accepted — try a simpler single beat.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-center px-4 pt-3 sm:absolute sm:inset-x-0 sm:bottom-4 sm:pt-0">
      <div className="w-full max-w-2xl">
        {(error || busy || scheduling || next) && (
          <div className="mb-1 text-center text-xs drop-shadow">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : busy ? (
              <span className="text-muted-foreground">Sending your direction…</span>
            ) : scheduling ? (
              <span className="text-muted-foreground">
                <span className="text-foreground">“{scheduling}”</span> is queued…
              </span>
            ) : (
              next && (
                <span className="text-muted-foreground">
                  <span className="text-foreground">“{next.instruction}”</span>
                  {waitMs > 0
                    ? ` lands in ${Math.ceil(waitMs / 1000)}s`
                    : ' is playing now'}
                </span>
              )
            )}
          </div>
        )}
        {showSuggestions && (
          <div className="mb-2 flex animate-[fadeIn_300ms_ease-out] flex-wrap justify-center gap-1.5">
            {actions.map((action) => (
              <button
                key={action}
                className="rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
                disabled={busy}
                onClick={() => void send(action)}
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
            placeholder="Direct the scene — what happens next?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            aria-label="Send direction"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
            disabled={!text.trim() || busy}
            onClick={() => void send()}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

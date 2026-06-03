import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

const MS_PER_CHAR = 25;

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

export type NarrativeLine = {
  id: string;
  text: string;
  kind?: 'error';
};

export function TypingNarrative({
  lines,
  isActive,
  suppressCursor = false
}: {
  lines: NarrativeLine[];
  isActive: boolean;
  suppressCursor?: boolean;
}) {
  const lastTextByIdRef = useRef<Map<string, string>>(
    new Map(lines.map((l) => [l.id, l.text]))
  );
  const [typing, setTyping] = useState<{ id: string; chars: number } | null>(null);

  useLayoutEffect(() => {
    for (const line of lines) {
      const lastText = lastTextByIdRef.current.get(line.id);
      if (lastText === undefined || lastText !== line.text) {
        const startChars =
          lastText === undefined ? 0 : commonPrefixLength(lastText, line.text);
        lastTextByIdRef.current.set(line.id, line.text);
        setTyping({ id: line.id, chars: startChars });
        return;
      }
    }
    // Narrative was cleared (retry/resume) — reset so new lines animate.
    if (lines.length === 0 && lastTextByIdRef.current.size > 0) {
      lastTextByIdRef.current = new Map();
      setTyping(null);
    }
  }, [lines]);

  useEffect(() => {
    if (!typing) return;
    const target = lines.find((l) => l.id === typing.id);
    if (!target) {
      setTyping(null);
      return;
    }
    if (typing.chars >= target.text.length) {
      setTyping(null);
      return;
    }
    const timer = setTimeout(() => {
      setTyping((t) => (t ? { ...t, chars: t.chars + 1 } : t));
    }, MS_PER_CHAR);
    return () => clearTimeout(timer);
  }, [typing, lines]);

  const lastLineId = lines.length > 0 ? lines[lines.length - 1].id : null;

  return (
    <>
      {lines.map((line) => {
        const isTypingThis = typing?.id === line.id;
        const displayText = isTypingThis ? line.text.slice(0, typing.chars) : line.text;
        const showCursor =
          !suppressCursor &&
          (isTypingThis || (isActive && !typing && line.id === lastLineId));
        return (
          <span key={line.id} className={cn(line.kind === 'error' && 'text-destructive')}>
            {displayText}
            {showCursor && <PulsingCursor />}
          </span>
        );
      })}
      {!suppressCursor && isActive && lines.length === 0 && (
        <span>
          <PulsingCursor />
        </span>
      )}
    </>
  );
}

export function PulsingCursor() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="-mt-1 ml-1 inline-block size-4 animate-[fade-cursor_1.2s_ease-in-out_infinite] text-primary"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1M7 22h1a4 4 0 0 0 4-4v-1M7 2h1a4 4 0 0 1 4 4v1"
      />
    </svg>
  );
}

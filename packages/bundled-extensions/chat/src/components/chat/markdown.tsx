import { memo } from 'react';

import { cn } from '@/lib/utils';

export type MarkdownProps = {
  children: string;
  id?: string;
  className?: string;
};

function MarkdownComponent({ children, className }: MarkdownProps) {
  const parts = children.split(':::loader:::');

  return (
    <div className={cn('whitespace-pre-wrap', className)}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <PulsingCursor />}
        </span>
      ))}
    </div>
  );
}

function PulsingCursor() {
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

const Markdown = memo(MarkdownComponent);
Markdown.displayName = 'Markdown';

export { Markdown };

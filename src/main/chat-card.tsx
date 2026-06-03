import { IconMessageCircle } from '@tabler/icons-react';
import type { MouseEvent } from 'react';

interface ChatCardProps {
  title: string;
  coverImageUrl: string | null;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export function ChatCard({
  title,
  coverImageUrl,
  onClick,
  onContextMenu
}: ChatCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="group flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-muted/40 text-left shadow-[inset_0_0_5px_rgba(0,0,0,0.1)] transition-colors"
    >
      {coverImageUrl ? (
        <img
          src={coverImageUrl}
          alt={title}
          loading="lazy"
          className="aspect-video w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-muted">
          <IconMessageCircle className="size-6 text-muted-foreground" />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-primary bg-background px-3 py-1 text-xs font-medium text-primary shadow-[inset_0_1px_0_var(--color-neutral-300),0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1)] dark:bg-primary dark:text-primary-foreground dark:shadow-none">
          Continue
        </span>
      </div>
    </button>
  );
}

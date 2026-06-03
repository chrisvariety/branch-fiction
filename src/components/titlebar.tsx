import { cn } from '@/lib/utils';

interface TitlebarProps {
  title?: string;
  rightActions?: React.ReactNode;
  className?: string;
}

const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

export function Titlebar({ title, rightActions, className }: TitlebarProps) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        'sticky top-0 z-50 flex h-10 shrink-0 items-center bg-background px-3 text-muted-foreground select-none',
        className
      )}
    >
      {IS_MAC && <div className="w-16 shrink-0" />}

      <div className="flex-1" />

      {title && (
        <span className="pointer-events-none absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-xs font-medium">
          {title}
        </span>
      )}

      <div className="flex shrink-0 items-center justify-end gap-1">{rightActions}</div>
    </header>
  );
}

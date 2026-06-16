import type { ReactNode } from 'react';

export function InteractiveModal({
  open,
  onClose,
  children
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-60 flex items-center justify-center bg-primary/50 px-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md duration-300 animate-in fade-in-0 zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative rounded-lg bg-background backdrop-blur-lg">
          <div className="relative max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain p-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

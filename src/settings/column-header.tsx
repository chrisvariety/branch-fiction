import type { ComponentType, ReactNode } from 'react';

export function ColumnHeader({
  icon: Icon,
  children
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <p className="mb-4 flex items-center gap-1.5 text-xs leading-none font-semibold tracking-wider text-muted-foreground uppercase">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

import { cn } from '@/lib/utils';

export function Container({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="mt-3 flex w-full items-start justify-center">
      <div className={cn('relative w-full max-w-lg lg:max-w-2xl', className)}>
        {children}
      </div>
    </div>
  );
}

export function HeaderContainer({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex w-full items-center justify-between p-4', className)}>
      {children}
    </div>
  );
}

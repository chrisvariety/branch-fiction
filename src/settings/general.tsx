import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';

import { useTheme } from '@/components/theme-provider';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';

type ThemeValue = 'light' | 'dark' | 'system';

const THEME_OPTIONS: { value: ThemeValue; label: string; icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'system', label: 'System', icon: IconDeviceDesktop }
];

function ThemePreview({ variant }: { variant: 'light' | 'dark' }) {
  const isDark = variant === 'dark';
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-2 p-2',
        isDark ? 'bg-neutral-900' : 'bg-neutral-100'
      )}
    >
      <div className="flex items-center justify-between">
        <div
          className={cn(
            'h-1 w-6 rounded-full',
            isDark ? 'bg-neutral-700' : 'bg-neutral-300'
          )}
        />
        <div
          className={cn(
            'size-1.5 rounded-full',
            isDark ? 'bg-neutral-700' : 'bg-neutral-300'
          )}
        />
      </div>
      <div className="grid flex-1 grid-cols-3 gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'aspect-[2/3] rounded-sm',
              isDark ? 'bg-neutral-700' : 'bg-neutral-300'
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ThemeCard({ value }: { value: ThemeValue }) {
  if (value === 'system') {
    return (
      <div className="relative h-full w-full">
        <ThemePreview variant="light" />
        <div
          className="absolute inset-0"
          style={{ clipPath: 'inset(0 0 0 50%)' }}
          aria-hidden
        >
          <ThemePreview variant="dark" />
        </div>
      </div>
    );
  }
  return <ThemePreview variant={value} />;
}

export function GeneralPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="sticky top-0 z-10 bg-background pb-4">
        <h2 className="text-sm font-medium">General</h2>
      </div>

      <FieldGroup>
        <Field orientation="vertical">
          <FieldLabel>Appearance</FieldLabel>
          <FieldDescription>Choose how the interface looks.</FieldDescription>
          <div
            role="radiogroup"
            aria-label="Appearance"
            className="grid grid-cols-3 gap-4"
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const isActive = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setTheme(value)}
                  className="flex flex-col items-center gap-2 outline-none"
                >
                  <div
                    className={cn(
                      'aspect-[3/2] w-full overflow-hidden rounded-xl transition-all',
                      isActive
                        ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                        : 'ring-1 ring-border hover:ring-foreground/30'
                    )}
                  >
                    <ThemeCard value={value} />
                  </div>
                  <div
                    className={cn(
                      'flex items-center gap-1.5 text-xs font-medium',
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <Icon className="size-3.5 stroke-[1.5]" />
                    {label}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>
      </FieldGroup>
    </div>
  );
}

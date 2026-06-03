import { useTheme } from './theme-provider';

const NEXT: Record<'light' | 'dark' | 'system', 'light' | 'dark' | 'system'> = {
  light: 'dark',
  dark: 'system',
  system: 'light'
};

const LABEL: Record<'light' | 'dark' | 'system', string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System'
};

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(NEXT[theme])}
      title={`Theme: ${LABEL[theme]} (click to cycle)`}
      className={`rounded-md border bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80 ${className}`}
    >
      Theme: {LABEL[theme]}
    </button>
  );
}

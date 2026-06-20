import { isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

export type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

const THEME_EVENT = 'theme:changed';

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'ui-theme'
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme
  );

  const fromRemote = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.classList.remove('light', 'dark');
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme;
      root.classList.add(resolved);
      // path.html opts into safe-area tinting via a theme-color meta; sync it so iOS insets track theme.
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        const bg = resolved === 'dark' ? '#1c1916' : '#fdfcfb';
        meta.setAttribute('content', bg);
        root.style.backgroundColor = bg;
      }
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<Theme>(THEME_EVENT, (e) => {
      fromRemote.current = true;
      setThemeState(e.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  function setTheme(next: Theme) {
    localStorage.setItem(storageKey, next);
    setThemeState(next);
    if (fromRemote.current) {
      fromRemote.current = false;
      return;
    }
    if (isTauri()) emit(THEME_EVENT, next).catch(() => {});
  }

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

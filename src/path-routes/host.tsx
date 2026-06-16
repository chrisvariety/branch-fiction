import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { type Theme, useTheme } from '../components/theme-provider';
import { mintSession, revokeSession } from '../extensions/session-tokens';
import { useWindowTitle } from '../hooks/use-window-title';
import { getExtensionById } from '../lib/db/models/extension/get-extension';
import { getHttpPort } from '../lib/media/transform-url';
import { rootRoute } from './__root';

export const hostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$extensionId',
  validateSearch: (search: Record<string, unknown>): { bookId?: string } => ({
    bookId: typeof search.bookId === 'string' ? search.bookId : undefined
  }),
  component: PathHost
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: PathMissing
});

function PathMissing() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      No extension specified.
    </div>
  );
}

type IframeBoot = {
  src: string;
  title: string;
  author: string | null;
};

function isTauriContext(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function resolveDark(theme: Theme): boolean {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return theme === 'dark';
}

function withDark(src: string, dark: boolean): string {
  const sep = src.includes('?') ? '&' : '?';
  return `${src}${sep}dark=${dark ? '1' : '0'}`;
}

function readPhoneBoot(): { token: string; entry: string; name: string } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const entry = params.get('entry');
  const name = params.get('name') ?? '';
  if (!token || !entry) return null;
  return { token, entry, name };
}

function PathHost() {
  const params = hostRoute.useParams();
  const search = hostRoute.useSearch();
  const extensionId = decodeURIComponent(params.extensionId);
  const bookId = search.bookId ?? null;
  const tauri = isTauriContext();

  const { theme } = useTheme();
  const darkRef = useRef(resolveDark(theme));
  darkRef.current = resolveDark(theme);

  const extensionQuery = useQuery({
    queryKey: ['path', 'extension', extensionId],
    queryFn: () => getExtensionById(extensionId),
    enabled: tauri
  });

  const [boot, setBoot] = useState<IframeBoot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useWindowTitle(boot?.title);

  const extension = extensionQuery.data;
  const manifest = extension?.manifest as
    | { author?: string; path?: { entry?: string } }
    | undefined;
  const name = extension?.name;
  const entry = manifest?.path?.entry;
  const author = manifest?.author ?? null;

  useEffect(() => {
    if (!tauri) {
      const phone = readPhoneBoot();
      if (!phone) {
        setBootError('Missing token or entry. Open this page via the Open on Phone QR.');
        return;
      }
      const origin = window.location.origin;
      const src = `${origin}/extension-assets/${encodeURIComponent(extensionId)}/${phone.entry}?token=${encodeURIComponent(phone.token)}`;
      setBoot({
        src: withDark(src, darkRef.current),
        title: phone.name || extensionId,
        author: null
      });
      return;
    }

    if (!name) return;
    if (!entry) {
      setBootError('Extension has no path entry.');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { token } = await mintSession({ extensionId, bookId });
        if (cancelled) return;
        // The embedded axum server is responsible for serving assets from /extension-assets
        const port = await getHttpPort();
        if (cancelled) return;
        const origin = `http://127.0.0.1:${port}`;
        const src = `${origin}/extension-assets/${encodeURIComponent(extensionId)}/${entry}?token=${encodeURIComponent(token)}`;
        setBoot({
          src: withDark(src, darkRef.current),
          title: name,
          author
        });
      } catch (e) {
        if (cancelled) return;
        setBootError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      void revokeSession(extensionId);
    };
  }, [tauri, extensionId, bookId, name, entry, author]);

  if (bootError) return <PathError message={bootError} />;
  if (tauri && extensionQuery.isError)
    return <PathError message={(extensionQuery.error as Error).message} />;
  if (!boot) return <PathLoading />;

  return (
    <div className="flex h-screen flex-col">
      <div data-tauri-drag-region className="absolute top-0 right-0 left-0 z-50 h-6" />
      <iframe
        src={boot.src}
        title={boot.title}
        sandbox="allow-scripts"
        allow="screen-wake-lock; fullscreen; gamepad; autoplay"
        className="flex-1 border-0 bg-transparent"
      />
    </div>
  );
}

function PathLoading() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Preparing path…
    </div>
  );
}

function PathError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-medium">Couldn't load this path.</p>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

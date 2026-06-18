import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { type Theme, useTheme } from '../components/theme-provider';
import {
  allocateExtensionPort,
  scrubExtensionOrigin
} from '../extensions/extension-port';
import {
  buildExtensionIframeAllow,
  type ExtensionPermission
} from '../extensions/manifest';
import { mintSession, revokeSession } from '../extensions/session-tokens';
import { useWindowTitle } from '../hooks/use-window-title';
import { getBookById } from '../lib/db/models/book/get-book';
import { getExtensionById } from '../lib/db/models/extension/get-extension';
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
  allow: string;
  sandbox: string;
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

// Permissions ride inside the signed session JWT, so tampering invalidates the token itself.
function decodeTokenPermissions(token: string): ExtensionPermission[] {
  try {
    const payload = token.split('.')[1];
    if (!payload) return [];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      permissions?: unknown;
    };
    if (!Array.isArray(claims.permissions)) return [];
    return claims.permissions.filter(
      (p): p is ExtensionPermission => typeof p === 'string'
    );
  } catch {
    return [];
  }
}

function readPhoneBoot(): {
  token: string;
  entry: string;
  name: string;
  permissions: ExtensionPermission[];
} | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const entry = params.get('entry');
  const name = params.get('name') ?? '';
  if (!token || !entry) return null;
  return { token, entry, name, permissions: decodeTokenPermissions(token) };
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
    queryFn: async () => {
      const found = await getExtensionById(extensionId);
      if (!found) throw new Error('This extension is no longer installed.');
      return found;
    },
    enabled: tauri
  });

  const bookQuery = useQuery({
    queryKey: ['path', 'book', bookId],
    queryFn: () => getBookById(bookId as string),
    enabled: tauri && bookId !== null
  });

  const [boot, setBoot] = useState<IframeBoot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const bookTitle = bookQuery.data?.title;
  useWindowTitle(
    boot?.title ? [boot.title, bookTitle].filter(Boolean).join(' — ') : undefined
  );

  const extension = extensionQuery.data;
  const manifest = extension?.manifest as
    | { author?: string; path?: { entry?: string }; permissions?: ExtensionPermission[] }
    | undefined;
  const name = extension?.name;
  const entry = manifest?.path?.entry;
  const author = manifest?.author ?? null;
  const permissions = manifest?.permissions;

  useEffect(() => {
    if (!tauri) {
      const phone = readPhoneBoot();
      if (!phone) {
        setBootError('Missing token or entry. Open this page via the Open on Phone QR.');
        return;
      }
      const origin = window.location.origin;
      const src = `${origin}/extension-assets/${encodeURIComponent(extensionId)}/${phone.entry}?token=${encodeURIComponent(phone.token)}`;
      // Cloud's https gateway is one origin: allow-same-origin keeps the iframe same-site so its
      // cookie-bound loads aren't cross-origin. LAN stays null-origin (no cookie) for isolation.
      const cloud = window.location.protocol === 'https:';
      // Capture permissions need a secure context; only delegate them on the cloud transport.
      setBoot({
        src: withDark(src, darkRef.current),
        title: phone.name || extensionId,
        author: null,
        allow: buildExtensionIframeAllow(cloud ? phone.permissions : undefined),
        sandbox: cloud ? 'allow-scripts allow-same-origin' : 'allow-scripts'
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
        // Each extension gets its own loopback origin so allow-same-origin storage stays isolated.
        const { port, needsClear } = await allocateExtensionPort(extensionId);
        if (cancelled) return;
        if (needsClear) await scrubExtensionOrigin(port);
        if (cancelled) return;
        const origin = `http://127.0.0.1:${port}`;
        const src = `${origin}/extension-assets/${encodeURIComponent(extensionId)}/${entry}?token=${encodeURIComponent(token)}`;
        setBoot({
          src: withDark(src, darkRef.current),
          title: name,
          author,
          allow: buildExtensionIframeAllow(permissions),
          sandbox: 'allow-scripts allow-same-origin'
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
  }, [tauri, extensionId, bookId, name, entry, author, permissions]);

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
        sandbox={boot.sandbox}
        allow={boot.allow}
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

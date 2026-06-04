// Returns the iframe-side SDK as an IIFE string, served at /extension-sdk.js.
export function extensionSdkSource(): string {
  return `(${extensionSdkClient.toString()})();`;
}

function extensionSdkClient() {
  type ProviderBinding = {
    baseURL: string;
    proxyBaseURL: string;
    modelKey?: string;
    providerType?: string;
    reasoning?: string;
  };
  type Ctx = {
    extensionId: string;
    bookId: string | null;
    providers: Record<string, ProviderBinding>;
    config: Record<string, unknown>;
    dark: boolean;
  };

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  // Sandboxed iframe origin is opaque; prefer `host` query param, fall back to SDK script origin.
  const scriptSrc =
    document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : '';
  const hostOrigin =
    params.get('host') ??
    (scriptSrc ? new URL(scriptSrc).origin : window.location.origin);
  if (!token) console.error('[extension-sdk] missing token query param');

  const darkParam = params.get('dark');
  const dark =
    darkParam === '1' || darkParam === 'true'
      ? true
      : darkParam === '0' || darkParam === 'false'
        ? false
        : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  try {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(dark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }

  const dataBase = `${hostOrigin.replace(/\/+$/, '')}/extension-data/${token}`;
  const logPrefix = '[extension]';

  const readyListeners: Array<(ctx: Ctx) => void> = [];
  let context: Ctx | null = null;

  function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function postJson<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${dataBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`${path} failed: ${r.status} ${await r.text()}`);
    return r.json() as Promise<T>;
  }

  type SseEvent = { event: string; data: string };
  async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let event = 'message';
    let dataLines: string[] = [];

    function flush(): SseEvent | null {
      if (dataLines.length === 0 && event === 'message') return null;
      const out = { event, data: dataLines.join('\n') };
      event = 'message';
      dataLines = [];
      return out;
    }

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Split on LF; SSE lines can use CRLF too — strip trailing \r.
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line === '') {
          const ev = flush();
          if (ev) yield ev;
          continue;
        }
        if (line.startsWith(':')) continue; // comment / keep-alive
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value =
          colon === -1
            ? ''
            : line.slice(colon + 1).startsWith(' ')
              ? line.slice(colon + 2)
              : line.slice(colon + 1);
        if (field === 'event') event = value;
        else if (field === 'data') dataLines.push(value);
      }
    }
    const tail = flush();
    if (tail) yield tail;
  }

  type WorkerSpawnHandle<T> = Promise<T> & {
    onLog(handler: (args: unknown[]) => void): WorkerSpawnHandle<T>;
    cancel(): void;
  };

  type WorkerSpawnOptions = { singletonKey?: string };

  function spawnWorker<T>(
    task: string,
    payload?: unknown,
    opts?: WorkerSpawnOptions
  ): WorkerSpawnHandle<T> {
    const ac = new AbortController();
    const logHandlers: Array<(args: unknown[]) => void> = [];
    let taskId: string | null = null;
    let cancelled = false;

    const promise: Promise<T> = (async () => {
      const r = await fetch(`${dataBase}/task/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          task,
          payload: payload ?? null,
          singletonKey: opts?.singletonKey ?? null
        }),
        signal: ac.signal
      });
      if (!r.ok || !r.body) {
        const err = new Error(
          `worker.spawn failed: ${r.status} ${await r.text().catch(() => '')}`
        );
        if (r.status === 409) err.name = 'TaskAlreadyRunningError';
        throw err;
      }
      for await (const ev of parseSse(r.body)) {
        if (ev.event === 'started') {
          try {
            taskId = (JSON.parse(ev.data) as { taskId: string }).taskId;
          } catch {
            /* ignore */
          }
        } else if (ev.event === 'log') {
          let args: unknown[] = [];
          try {
            args = (JSON.parse(ev.data) as { args: unknown[] }).args ?? [];
          } catch {
            /* ignore */
          }
          for (const h of logHandlers) {
            try {
              h(args);
            } catch (e) {
              console.error('[extension-sdk] log handler threw', e);
            }
          }
        } else if (ev.event === 'result') {
          const parsed = JSON.parse(ev.data) as { value: T };
          return parsed.value;
        } else if (ev.event === 'error') {
          const { message } = JSON.parse(ev.data) as { message: string };
          throw new Error(message);
        }
      }
      throw new Error('worker.spawn stream ended without result');
    })();

    const handle = promise as WorkerSpawnHandle<T>;
    handle.onLog = (handler) => {
      logHandlers.push(handler);
      return handle;
    };
    handle.cancel = () => {
      if (cancelled) return;
      cancelled = true;
      ac.abort();
      if (taskId) {
        void fetch(`${dataBase}/task/${taskId}/cancel`, { method: 'POST' }).catch(
          () => {}
        );
      }
    };
    return handle;
  }

  const sdk = {
    extensionId: '' as string,
    hostOrigin,
    dark,
    providers: {} as Record<string, ProviderBinding>,
    config: {} as Record<string, unknown>,
    onReady(fn: (ctx: Ctx) => void) {
      if (context) fn(context);
      else readyListeners.push(fn);
    },
    db: {
      async query(sql: string, params?: unknown[]) {
        return postJson<{ rows: unknown[]; changes: number }>('/db/query', {
          sql,
          params: params ?? []
        });
      }
    },
    fs: {
      async read(relPath: string): Promise<Uint8Array> {
        const r = await postJson<{ bytesBase64: string }>('/fs/read', { relPath });
        return base64ToBytes(r.bytesBase64);
      },
      async write(relPath: string, bytes: Uint8Array): Promise<void> {
        await postJson<unknown>('/fs/write', {
          relPath,
          bytesBase64: bytesToBase64(bytes)
        });
      },
      async list(relPath?: string) {
        return postJson<{ name: string; isDirectory: boolean }[]>('/fs/list', {
          relPath: relPath ?? null
        });
      }
    },
    worker: {
      spawn<T = unknown>(
        task: string,
        payload?: unknown,
        opts?: WorkerSpawnOptions
      ): WorkerSpawnHandle<T> {
        return spawnWorker<T>(task, payload, opts);
      }
    },
    log(...args: unknown[]) {
      console.log(logPrefix, ...args);
    }
  };

  (window as unknown as { extensionSDK: typeof sdk }).extensionSDK = sdk;

  void (async () => {
    try {
      const r = await fetch(`${dataBase}/context`);
      if (!r.ok) throw new Error(`context ${r.status}`);
      const ctx = { ...((await r.json()) as Ctx), dark };
      context = ctx;
      sdk.extensionId = ctx.extensionId;
      sdk.providers = ctx.providers ?? {};
      sdk.config = ctx.config ?? {};
      for (const fn of readyListeners) {
        try {
          fn(ctx);
        } catch (e) {
          console.error('[extension-sdk] onReady handler threw', e);
        }
      }
    } catch (e) {
      console.error('[extension-sdk] failed to fetch context', e);
    }
  })();
}

// Type surface extension authors get when importing this package.

export type ExtensionProviderBinding = {
  baseURL: string;
  proxyBaseURL: string;
  modelKey?: string;
  providerType?: string;
  reasoning?: import('@earendil-works/pi-ai').ThinkingLevel;
};

export type ExtensionCtx = {
  extensionId: string;
  bookId: string | null;
  providers: Record<string, ExtensionProviderBinding>;
  config: Record<string, unknown>;
  dark: boolean;
};

export type WorkerSpawnHandle<T> = Promise<T> & {
  onLog(handler: (args: unknown[]) => void): WorkerSpawnHandle<T>;
  cancel(): void;
};

export type WorkerSpawnOptions = {
  // single-flight per extension + book; duplicates reject with TaskAlreadyRunningError
  singletonKey?: string;
};

export function isTaskAlreadyRunningError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TaskAlreadyRunningError';
}

export interface ExtensionSDK {
  // Populated after `onReady`. Empty string before then.
  extensionId: string;
  // Origin of the host's HTTP server (the one serving /extension-data/*).
  hostOrigin: string;
  dark: boolean;
  providers: Record<string, ExtensionProviderBinding>;
  config: Record<string, unknown>;
  onReady(fn: (ctx: ExtensionCtx) => void): void;
  db: {
    query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; changes: number }>;
  };
  fs: {
    read(relPath: string): Promise<Uint8Array>;
    write(relPath: string, bytes: Uint8Array): Promise<void>;
    list(relPath?: string): Promise<{ name: string; isDirectory: boolean }[]>;
  };
  worker: {
    spawn<T = unknown>(
      task: string,
      payload?: unknown,
      opts?: WorkerSpawnOptions
    ): WorkerSpawnHandle<T>;
  };
  log(...args: unknown[]): void;
}

export interface ExtensionHost {
  extensionId: string;
  bookId: string | null;
  providers: Record<string, ExtensionProviderBinding>;
  config: Record<string, unknown>;
  // Absolute path to this extension's private SQLite file. Open it with whichever
  // client you prefer (`node:sqlite`, better-sqlite3, drizzle, kysely, …).
  dbPath: string;
  fs: {
    read(relPath: string): Promise<Uint8Array>;
    write(relPath: string, bytes: Uint8Array): Promise<void>;
    list(relPath?: string): Promise<{ name: string; isDirectory: boolean }[]>;
  };
  log(...args: unknown[]): void;
}

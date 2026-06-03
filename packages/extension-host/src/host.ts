import { list, read, write } from '@/host-fs';
import { sendNotification } from '@/rpc-worker';

export type ProviderHandle = {
  baseURL: string;
  proxyBaseURL: string;
  modelKey?: string;
  // Pre-built pi-ai handle for `useSlot` requirements. Extension can pass it
  // directly to pi-ai's `run`/`generate` calls. baseUrl on the model points
  // at the host proxy; the API key is the proxy token.
  pi?: unknown;
};

export type HostInit = {
  extensionId: string;
  bookId: string | null;
  providers: Record<string, ProviderHandle>;
  config: Record<string, unknown>;
  dbPath: string;
};

export function setupHost(args: HostInit): void {
  const host = {
    extensionId: args.extensionId,
    bookId: args.bookId,
    providers: args.providers,
    config: args.config,
    dbPath: args.dbPath,
    fs: { read, write, list },
    log: (...logArgs: unknown[]) => {
      sendNotification('host.log', { args: serializeLogArgs(logArgs) });
    }
  };
  (globalThis as unknown as { host: typeof host }).host = host;
}

function serializeLogArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (a instanceof Error) {
      return { name: a.name, message: a.message, stack: a.stack };
    }
    if (a instanceof Uint8Array) {
      return { __binary: true, length: a.length };
    }
    return a;
  });
}

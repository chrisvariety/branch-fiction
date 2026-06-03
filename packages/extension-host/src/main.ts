// Must run before any other import so extension-worker module init can probe
// env vars without tripping Deno's NotCapable.
import '@/env-soft';
import { type ProviderHandle, setupHost } from '@/host';
import { setDataRoot } from '@/host-fs';
import { serveRPC } from '@/rpc-worker';

let initialized = false;
let extensionWorkerPath: string | null = null;

type InitArgs = {
  extensionId: string;
  bookId: string | null;
  providers: Record<string, ProviderHandle>;
  config: Record<string, unknown>;
  dbPath: string;
  dataDir: string;
  extensionWorkerPath: string;
};

const api = {
  init(args: InitArgs) {
    if (initialized) return { ok: true } as const;
    setDataRoot(args.dataDir);
    setupHost({
      extensionId: args.extensionId,
      bookId: args.bookId,
      providers: args.providers,
      config: args.config,
      dbPath: args.dbPath
    });
    extensionWorkerPath = args.extensionWorkerPath;
    initialized = true;
    return { ok: true } as const;
  },

  async runTask({ task, payload }: { task: string; payload?: unknown }) {
    if (!initialized) throw new Error('runTask called before init');
    if (!extensionWorkerPath) throw new Error('extension worker path missing');

    const url = extensionWorkerPath.startsWith('file://')
      ? extensionWorkerPath
      : `file://${extensionWorkerPath}`;

    let mod: Record<string, unknown>;
    try {
      mod = (await import(url)) as Record<string, unknown>;
    } catch (e) {
      const err = e as Error;
      throw new Error(`failed to import extension worker (${url}): ${err.message}`);
    }
    const handler = (mod[task] ?? mod.default) as
      | ((payload: unknown) => unknown)
      | undefined;
    if (typeof handler !== 'function') {
      throw new Error(`Extension has no handler for task "${task}"`);
    }
    const result = await handler(payload);
    return { result };
  }
};

await serveRPC(api as unknown as Record<string, (...args: unknown[]) => unknown>);

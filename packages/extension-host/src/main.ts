// Must run before any other import so extension-worker module init can probe
// env vars without tripping Deno's NotCapable.
import '@/env-soft';
import { applyModelsCatalog } from '@branch-fiction/extension-sdk/models-catalog';

import { type ProviderHandle, setupHost } from '@/host';
import { setDataRoot } from '@/host-fs';
import { serveRPC } from '@/rpc-worker';

let initialized = false;
let extensionWorkerUrl: string | null = null;

type InitArgs = {
  extensionId: string;
  bookId: string | null;
  providers: Record<string, ProviderHandle>;
  config: Record<string, unknown>;
  dbPath: string;
  dataDir: string;
  modelsCatalogPath?: string | null;
  extensionWorkerUrl: string;
};

// overlay lives on globalThis, so this also covers the extension worker bundle
async function loadModelsCatalog(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    applyModelsCatalog(JSON.parse(await Deno.readTextFile(path)));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error(`[extension-host] failed to load models catalog: ${e}`);
    }
  }
}

const api = {
  async init(args: InitArgs) {
    if (initialized) return { ok: true } as const;
    await loadModelsCatalog(args.modelsCatalogPath);
    setDataRoot(args.dataDir);
    setupHost({
      extensionId: args.extensionId,
      bookId: args.bookId,
      providers: args.providers,
      config: args.config,
      dbPath: args.dbPath
    });
    extensionWorkerUrl = args.extensionWorkerUrl;
    initialized = true;
    return { ok: true } as const;
  },

  async runTask({ task, payload }: { task: string; payload?: unknown }) {
    if (!initialized) throw new Error('runTask called before init');
    if (!extensionWorkerUrl) throw new Error('extension worker url missing');

    let mod: Record<string, unknown>;
    try {
      mod = (await import(extensionWorkerUrl)) as Record<string, unknown>;
    } catch (e) {
      const err = e as Error;
      throw new Error(
        `failed to import extension worker (${extensionWorkerUrl}): ${err.message}`
      );
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

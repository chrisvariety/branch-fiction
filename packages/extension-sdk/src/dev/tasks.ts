import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

import type { ProviderHandle } from './tokens';

export type StartTaskRequest = { task: string; payload?: unknown };

export type WorkerEvent =
  | { kind: 'log'; args: unknown[] }
  | { kind: 'result'; value: unknown }
  | { kind: 'error'; message: string };

export type WorkerHandle = {
  taskId: string;
  events: AsyncIterable<WorkerEvent>;
  cancel(): void;
};

export type SpawnArgs = {
  extensionId: string;
  bookId: string | null;
  extensionDir: string;
  workerEntry: string;
  extensionHostBundle: string;
  denoBin: string;
  // root that contains both the SQLite db and the assets dir.
  // used for Deno `--allow-read/write`
  extensionDataRoot: string;
  // passed to the worker as its dataDir.
  assetsDir: string;
  dbPath: string;
  providers: Record<string, ProviderHandle>;
  config: Record<string, unknown>;
  netAllowlist: string[];
  hostPort: number;
  task: string;
  payload: unknown;
  controllers: Map<string, AbortController>;
};

export function spawnWorker(args: SpawnArgs): WorkerHandle {
  const taskId = `ptk_${randomUUID().replace(/-/g, '')}`;
  const ac = new AbortController();
  args.controllers.set(taskId, ac);

  const allowRead = [
    args.extensionDataRoot,
    args.extensionDir,
    dirname(args.extensionHostBundle)
  ]
    .filter(Boolean)
    .join(',');
  const allowWrite = args.extensionDataRoot;
  const allowNet = [
    `127.0.0.1:${args.hostPort}`,
    `localhost:${args.hostPort}`,
    ...args.netAllowlist
  ].join(',');

  const denoArgs = [
    'run',
    '--no-config',
    `--allow-read=${allowRead}`,
    `--allow-write=${allowWrite}`,
    `--allow-net=${allowNet}`,
    args.extensionHostBundle
  ];

  const child = spawn(args.denoBin, denoArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: ac.signal
  });

  const events = pump(child, args, ac, args.controllers, taskId);

  return {
    taskId,
    events,
    cancel: () => ac.abort()
  };
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(0, idx);
}

const INIT_REQ_ID = 1;
const RUN_REQ_ID = 2;

async function* pump(
  child: ChildProcess,
  args: SpawnArgs,
  _ac: AbortController,
  controllers: Map<string, AbortController>,
  taskId: string
): AsyncGenerator<WorkerEvent> {
  const buffer: WorkerEvent[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  let error: Error | null = null;

  const onErr = (e: Error) => {
    if (e.name === 'AbortError') return;
    error = e;
    done = true;
    resolve?.();
  };

  const initReq =
    JSON.stringify({
      jsonrpc: '2.0',
      id: INIT_REQ_ID,
      method: 'init',
      params: [
        {
          extensionId: args.extensionId,
          bookId: args.bookId,
          providers: serializableProviders(args.providers),
          config: args.config,
          dbPath: args.dbPath,
          dataDir: args.assetsDir,
          extensionWorkerPath: `${args.extensionDir.replace(/\/+$/, '')}/${args.workerEntry.replace(/^\.?\/+/, '')}`
        }
      ]
    }) + '\n';

  child.stdin?.write(initReq);

  if (child.stdout) {
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return;
      }
      const id = typeof msg.id === 'number' ? msg.id : null;
      if (id === null) {
        if (msg.method === 'host.log') {
          const params = (msg.params as { args?: unknown[] }) ?? {};
          buffer.push({ kind: 'log', args: params.args ?? [] });
          resolve?.();
        }
        return;
      }
      if (id === INIT_REQ_ID) {
        if (msg.error) {
          buffer.push({
            kind: 'error',
            message: errorMessage(msg.error) || 'init failed'
          });
          done = true;
          resolve?.();
          return;
        }
        const runReq =
          JSON.stringify({
            jsonrpc: '2.0',
            id: RUN_REQ_ID,
            method: 'runTask',
            params: [{ task: args.task, payload: args.payload }]
          }) + '\n';
        child.stdin?.write(runReq);
      } else if (id === RUN_REQ_ID) {
        if (msg.error) {
          buffer.push({ kind: 'error', message: errorMessage(msg.error) });
        } else {
          const result = (msg.result as { result?: unknown } | undefined)?.result ?? null;
          buffer.push({ kind: 'result', value: result });
        }
        done = true;
        resolve?.();
      }
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trimEnd();
      if (text) console.error(`[extension-host:${args.extensionId}]`, text);
    });
  }

  child.on('error', onErr);
  child.on('exit', () => {
    if (!done) {
      buffer.push({
        kind: 'error',
        message: 'extension worker exited without returning a result'
      });
      done = true;
    }
    resolve?.();
  });

  try {
    while (true) {
      while (buffer.length > 0) {
        const ev = buffer.shift()!;
        yield ev;
        if (ev.kind === 'result' || ev.kind === 'error') return;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((r) => {
        resolve = r;
      });
      resolve = null;
    }
  } finally {
    controllers.delete(taskId);
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

function serializableProviders(
  providers: Record<string, ProviderHandle>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(providers)) {
    out[k] = { ...v };
  }
  return out;
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'unknown error';
}

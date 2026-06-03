import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';

import { type ExtensionManifestV1, validateManifest } from '../manifest';
import { extensionSdkSource } from '../sdk-source';
import { checkDevConfig, readDevConfig, writeDevConfig } from './config';
import { dbQuery } from './db';
import { fsList, fsRead, fsWrite, safeJoin } from './fs';
import { proxyToProvider } from './proxy';
import { SETUP_UI_HTML } from './setup-ui';
import { spawnWorker } from './tasks';
import { registry } from './tokens';
import type { DevConfig, DevRuntimeOptions } from './types';

export type DevServer = {
  app: Hono;
};

const ASSET_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm'
};

export function createDevServer(opts: DevRuntimeOptions): DevServer {
  const app = new Hono();
  app.use('*', cors({ origin: '*', allowHeaders: ['*'], allowMethods: ['*'] }));

  const dataDir = opts.dataDir;
  const configPath = opts.configPath ?? join(opts.extensionDir, 'dev.config.json');
  const dbPath = opts.dbPath;
  const assetsDir = opts.assetsDir;
  const taskControllers = new Map();
  const hostOrigin = `http://localhost:${opts.hostPort}`;

  function loadManifest(): ExtensionManifestV1 {
    const raw = readFileSync(join(opts.extensionDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw) as ExtensionManifestV1;
    validateManifest(manifest);
    return manifest;
  }

  function listBooks(): { id: string; title: string }[] {
    if (!existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      return db
        .prepare("SELECT id, title FROM books WHERE status = 'completed' ORDER BY title")
        .all() as { id: string; title: string }[];
    } catch {
      return [];
    } finally {
      db.close();
    }
  }

  app.get('/extension-sdk.js', (c) => {
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    return c.body(extensionSdkSource());
  });

  app.get('/extension-data/:token/context', (c) => {
    const token = c.req.param('token');
    if (!registry.isValidDataToken(token)) return c.text('unauthorized', 401);
    const manifest = loadManifest();
    const config = readDevConfig(configPath);
    const providers = registry.buildProviders(manifest, config, hostOrigin);
    return c.json({
      extensionId: manifest.id,
      bookId: config.bookId ?? null,
      providers,
      config: config.config ?? {}
    });
  });

  app.post('/extension-data/:token/db/query', async (c) => {
    const token = c.req.param('token');
    if (!registry.isValidDataToken(token)) return c.text('unauthorized', 401);
    const body = (await c.req.json()) as { sql: string; params?: unknown[] };
    try {
      return c.json(dbQuery(dbPath, body));
    } catch (e) {
      return c.text(`db.query: ${(e as Error).message}`, 400);
    }
  });

  app.post('/extension-data/:token/fs/read', async (c) => {
    const token = c.req.param('token');
    if (!registry.isValidDataToken(token)) return c.text('unauthorized', 401);
    const body = (await c.req.json()) as { relPath: string };
    try {
      return c.json(fsRead(assetsDir, body.relPath));
    } catch (e) {
      return c.text(`fs.read: ${(e as Error).message}`, 400);
    }
  });
  app.post('/extension-data/:token/fs/write', async (c) => {
    const token = c.req.param('token');
    if (!registry.isValidDataToken(token)) return c.text('unauthorized', 401);
    const body = (await c.req.json()) as { relPath: string; bytesBase64: string };
    try {
      return c.json(fsWrite(assetsDir, body.relPath, body.bytesBase64));
    } catch (e) {
      return c.text(`fs.write: ${(e as Error).message}`, 400);
    }
  });
  app.post('/extension-data/:token/fs/list', async (c) => {
    const token = c.req.param('token');
    if (!registry.isValidDataToken(token)) return c.text('unauthorized', 401);
    const body = (await c.req.json().catch(() => ({}))) as { relPath?: string | null };
    return c.json(fsList(assetsDir, body.relPath ?? null));
  });

  app.post('/extension-data/:token/task/start', async (c) => {
    const token = c.req.param('token');
    if (!registry.isValidDataToken(token)) return c.text('unauthorized', 401);
    const body = (await c.req.json()) as { task: string; payload?: unknown };
    const manifest = loadManifest();
    const workerEntry = manifest.path?.worker;
    if (!workerEntry) return c.text('extension has no path.worker entry', 400);
    const config = readDevConfig(configPath);
    const providers = registry.buildProviders(manifest, config, hostOrigin);

    const handle = spawnWorker({
      extensionId: manifest.id,
      bookId: config.bookId ?? null,
      extensionDir: opts.extensionDir,
      workerEntry,
      extensionHostBundle: opts.extensionHostBundle,
      denoBin: opts.denoBin,
      extensionDataRoot: dataDir,
      assetsDir,
      dbPath,
      providers,
      config: config.config ?? {},
      netAllowlist: manifest.net ?? [],
      hostPort: opts.hostPort,
      task: body.task,
      payload: body.payload ?? null,
      controllers: taskControllers
    });

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'started',
        data: JSON.stringify({ taskId: handle.taskId })
      });
      try {
        for await (const ev of handle.events) {
          if (ev.kind === 'log') {
            await stream.writeSSE({
              event: 'log',
              data: JSON.stringify({ args: ev.args })
            });
          } else if (ev.kind === 'result') {
            await stream.writeSSE({
              event: 'result',
              data: JSON.stringify({ value: ev.value })
            });
            return;
          } else {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ message: ev.message })
            });
            return;
          }
        }
      } finally {
        handle.cancel();
      }
    });
  });

  app.post('/extension-data/:token/task/:taskId/cancel', (c) => {
    const token = c.req.param('token');
    if (!registry.isValidDataToken(token)) return c.text('unauthorized', 401);
    const taskId = c.req.param('taskId');
    const ac = taskControllers.get(taskId);
    if (ac) ac.abort();
    return c.body(null, 204);
  });

  app.all('/extension-providers/:token/:providerKey/*', async (c) => {
    const token = c.req.param('token');
    const providerKey = c.req.param('providerKey');
    const path = c.req.path;
    const prefix = `/extension-providers/${token}/${providerKey}/`;
    const rest = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    const found = registry.resolveProxyForKey(token, providerKey);
    if (!found) {
      console.warn(
        `[proxy] (unknown token ${token.slice(0, 12)}… or key ${providerKey}) ${c.req.method} /${rest} -> 401`
      );
      return c.text('unknown proxy token', 401);
    }
    return proxyToProvider(c, providerKey, found, rest);
  });

  app.get('/extension-assets/:extensionId/*', (c) => {
    if (c.req.param('extensionId') !== loadManifest().id) {
      return c.text('unknown extension', 404);
    }
    const marker = '/assets/';
    const idx = c.req.path.indexOf(marker);
    const relPath =
      idx >= 0 ? decodeURIComponent(c.req.path.slice(idx + marker.length)) : '';
    if (!relPath) return c.text('missing path', 400);
    let fullPath: string;
    try {
      fullPath = safeJoin(assetsDir, relPath);
    } catch (e) {
      return c.text((e as Error).message, 400);
    }
    if (!existsSync(fullPath)) return c.text('not found', 404);
    const ext = relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase();
    const mime = ASSET_MIME[ext] ?? 'application/octet-stream';
    c.header('Content-Type', mime);
    c.header('Cache-Control', 'no-cache');
    return c.body(readFileSync(fullPath));
  });

  // Mirrors the Tauri `public_asset_handler` route so extension code that
  // builds `/extension-data/<id>/assets/...` URLs works the same in dev.
  app.get('/extension-data/:extensionId/assets/*', (c) => {
    if (c.req.param('extensionId') !== loadManifest().id) {
      return c.text('unknown extension', 404);
    }
    const marker = '/assets/';
    const idx = c.req.path.indexOf(marker);
    const relPath =
      idx >= 0 ? decodeURIComponent(c.req.path.slice(idx + marker.length)) : '';
    if (!relPath) return c.text('missing path', 400);
    let fullPath: string;
    try {
      fullPath = safeJoin(assetsDir, relPath);
    } catch (e) {
      return c.text((e as Error).message, 400);
    }
    if (!existsSync(fullPath)) return c.text('not found', 404);
    const ext = relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase();
    const mime = ASSET_MIME[ext] ?? 'application/octet-stream';
    c.header('Content-Type', mime);
    c.header('Cache-Control', 'no-cache');
    return c.body(readFileSync(fullPath));
  });

  app.get('/__dev__/setup', (c) => {
    c.header('Content-Type', 'text/html; charset=utf-8');
    return c.body(SETUP_UI_HTML);
  });

  app.get('/__dev__/api/status', (c) => {
    const manifest = loadManifest();
    const config = readDevConfig(configPath);
    const status = checkDevConfig(manifest, config);
    return c.json({
      extensionId: manifest.id,
      manifest,
      config,
      ok: status.ok,
      missing: status.missing,
      configPath,
      books: listBooks()
    });
  });

  app.post('/__dev__/api/save', async (c) => {
    const next = (await c.req.json()) as DevConfig;
    writeDevConfig(configPath, next);
    return c.json({ ok: true });
  });

  app.get('/__dev__/api/launch-url', (c) => {
    const config = readDevConfig(configPath);
    if (!config.bookId) {
      return c.json({ ok: false, error: 'select a book before launching' }, 400);
    }
    const books = listBooks();
    if (!books.some((b) => b.id === config.bookId)) {
      return c.json(
        {
          ok: false,
          error: `selected book ${config.bookId} is not in the dev DB — re-seed?`
        },
        400
      );
    }
    const token = registry.mintDataToken();
    const url = `${opts.viteOrigin}?token=${encodeURIComponent(token)}&host=${encodeURIComponent(hostOrigin)}`;
    return c.json({ ok: true, url });
  });

  return { app };
}

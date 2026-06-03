import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';

import type { Database as DB, ProviderAuthShape } from '@/app/lib/db/types';
import { configureBridge } from '@/lib/bridge';
import { createKyselyDb } from '@/lib/db';

type ResolvedSlot = {
  providerType: string;
  modelId: string;
  reasoning: string | null;
  baseUrl: string;
  authShape: ProviderAuthShape;
  secret: string | null;
};

export type LocalBridgeHandle = {
  port: number;
  token: string;
  shutdown: () => Promise<void>;
};

export async function startLocalBridge(opts: {
  mainDbPath: string;
  bookImportId: string;
}): Promise<LocalBridgeHandle> {
  const { mainDbPath, bookImportId } = opts;
  const token = uuidv7();
  const mainDb = createKyselyDb(mainDbPath);

  const { port, server } = await listen((req) =>
    handleRequest(req, token, bookImportId, mainDb)
  );

  configureBridge(port, token);

  return {
    port,
    token,
    shutdown: async () => {
      await server.shutdown();
      await mainDb.destroy();
    }
  };
}

async function listen(
  handler: (req: Request) => Promise<Response>
): Promise<{ port: number; server: Deno.HttpServer }> {
  const { promise, resolve } = Promise.withResolvers<number>();
  const server = Deno.serve(
    {
      port: 0,
      hostname: '127.0.0.1',
      onListen: ({ port }) => resolve(port)
    },
    handler
  );
  const port = await promise;
  return { port, server };
}

async function handleRequest(
  req: Request,
  token: string,
  bookImportId: string,
  mainDb: Kysely<DB>
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    const workerPrefix = `/v1/worker/${token}`;
    if (path.startsWith(workerPrefix)) {
      return await handleWorker(
        req,
        path.slice(workerPrefix.length),
        bookImportId,
        mainDb
      );
    }

    const proxyPrefix = `/system-proxy/${token}/`;
    if (path.startsWith(proxyPrefix)) {
      const rest = path.slice(proxyPrefix.length);
      const slashIdx = rest.indexOf('/');
      const slot = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
      const tail = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);
      return await handleSystemProxy(req, slot, tail, bookImportId, mainDb);
    }

    return new Response('unknown bridge token or route', { status: 401 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[local-bridge] ${req.method} ${path} -> 500: ${message}`);
    return new Response(message, { status: 500 });
  }
}

async function handleWorker(
  req: Request,
  subpath: string,
  bookImportId: string,
  db: Kysely<DB>
): Promise<Response> {
  if (req.method === 'GET' && subpath === '/slots/resolve') {
    const out: Record<
      string,
      { providerType: string; modelId: string; reasoning?: string }
    > = {};
    for (const slot of ['piText', 'piTextLight']) {
      const pmid = await boundProviderModelId(db, bookImportId, slot);
      if (!pmid) continue;
      const row = await loadProviderRow(db, pmid);
      if (!row) continue;
      out[slot] = {
        providerType: row.providerType,
        modelId: row.modelKey,
        ...(row.reasoning ? { reasoning: row.reasoning } : {})
      };
    }
    return jsonResponse(out);
  }

  if (req.method === 'POST' && subpath === '/import/sync') {
    return new Response(null, { status: 204 });
  }

  if (req.method === 'GET' && subpath === '/book-import') {
    const row = await db
      .selectFrom('bookImports')
      .selectAll()
      .where('id', '=', bookImportId)
      .executeTakeFirst();
    return jsonResponse(row ?? null);
  }

  if (req.method === 'POST' && subpath === '/book-import/update') {
    const body = (await req.json()) as Record<string, unknown> & {
      incrementErrorCount?: boolean;
    };
    const { incrementErrorCount, ...fields } = body;
    let update = db
      .updateTable('bookImports')
      .set({ ...fields, updatedAt: sql`CURRENT_TIMESTAMP` });
    if (incrementErrorCount) {
      update = update.set({ errorCount: sql`COALESCE(error_count, 0) + 1` });
    }
    await update.where('id', '=', bookImportId).execute();
    return new Response(null, { status: 204 });
  }

  const bookMatch = subpath.match(/^\/books\/([^/]+)(\/update)?$/);
  if (bookMatch) {
    const id = decodeURIComponent(bookMatch[1]);
    if (req.method === 'GET') {
      const row = await db
        .selectFrom('books')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return jsonResponse(row ?? null);
    }
    if (req.method === 'POST' && bookMatch[2] === '/update') {
      const fields = (await req.json()) as Record<string, unknown>;
      await db
        .updateTable('books')
        .set({ ...fields, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where('id', '=', id)
        .execute();
      return new Response(null, { status: 204 });
    }
  }

  if (req.method === 'POST' && subpath === '/books') {
    const body = (await req.json()) as {
      id: string;
      userId: string;
      shareCode: string;
      baseSlug: string;
      title: string;
      isbn: string | null;
      language: string | null;
      publisher: string | null;
      imageUrl: string | null;
    };
    const slug = await findAvailableSlug(db, body.baseSlug);
    await db
      .insertInto('books')
      .values({
        id: body.id,
        userId: body.userId,
        shareCode: body.shareCode,
        slug,
        title: body.title,
        isbn: body.isbn,
        language: body.language,
        publisher: body.publisher,
        imageUrl: body.imageUrl
      })
      .execute();
    const row = await db
      .selectFrom('books')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirst();
    if (!row) return new Response('books row missing after insert', { status: 500 });
    return jsonResponse(row);
  }

  return new Response(`unhandled worker route ${req.method} ${subpath}`, { status: 404 });
}

async function findAvailableSlug(db: Kysely<DB>, baseSlug: string): Promise<string> {
  const candidates = [
    baseSlug,
    ...Array.from({ length: 10 }, (_, i) => `${baseSlug}-${i + 1}`)
  ];
  for (const candidate of candidates) {
    const exists = await db
      .selectFrom('books')
      .select('id')
      .where('slug', '=', candidate)
      .executeTakeFirst();
    if (!exists) return candidate;
  }
  return `${baseSlug}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function handleSystemProxy(
  req: Request,
  slot: string,
  rest: string,
  bookImportId: string,
  mainDb: Kysely<DB>
): Promise<Response> {
  const slotInfo = await resolveSlot(mainDb, bookImportId, slot);
  if (!slotInfo) {
    return new Response(`no provider model configured for slot "${slot}"`, {
      status: 502
    });
  }

  const targetBase = slotInfo.baseUrl.replace(/\/+$/, '');
  const tail = rest.replace(/^\/+/, '');
  const target = new URL(tail ? `${targetBase}/${tail}` : targetBase);
  for (const [k, v] of new URL(req.url).searchParams.entries()) {
    target.searchParams.append(k, v);
  }

  const outHeaders = new Headers();
  for (const [name, value] of req.headers.entries()) {
    const lower = name.toLowerCase();
    if (
      lower === 'host' ||
      lower === 'authorization' ||
      lower === 'x-goog-api-key' ||
      lower === 'content-length' ||
      lower === 'connection'
    ) {
      continue;
    }
    if (
      slotInfo.authShape.kind === 'header' &&
      lower === slotInfo.authShape.header.toLowerCase()
    ) {
      continue;
    }
    outHeaders.append(name, value);
  }

  let body: BodyInit | null = null;
  const isGetOrHead = req.method === 'GET' || req.method === 'HEAD';

  if (slotInfo.authShape.kind === 'body') {
    if (isGetOrHead) {
      return new Response('body auth requires a JSON request body', { status: 400 });
    }
    const text = await req.text();
    if (!text) {
      return new Response('body auth requires a JSON request body', { status: 400 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return new Response(`body auth: invalid json: ${(e as Error).message}`, {
        status: 400
      });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return new Response('body auth: JSON root must be an object', { status: 400 });
    }
    (parsed as Record<string, unknown>)[slotInfo.authShape.field] = slotInfo.secret ?? '';
    body = JSON.stringify(parsed);
    outHeaders.set('content-type', 'application/json');
  } else if (!isGetOrHead) {
    // Buffer the body instead of forwarding req.body as a stream.
    // mirrors src-tauri/src/provider_proxy.rs, which always buffers.
    const buf = await req.arrayBuffer();
    body = buf.byteLength > 0 ? new Uint8Array(buf) : null;
  }

  applyAuth(slotInfo, outHeaders, target);

  const upstream = await fetch(target, {
    method: req.method,
    headers: outHeaders,
    body
  });

  console.info(
    `[local-bridge proxy] ${slot} ${req.method} ${target} -> ${upstream.status}`
  );

  const respHeaders = new Headers(upstream.headers);
  respHeaders.delete('content-length');
  respHeaders.delete('content-encoding');
  respHeaders.delete('transfer-encoding');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders
  });
}

function applyAuth(slot: ResolvedSlot, headers: Headers, url: URL): void {
  if (!slot.secret) return;
  switch (slot.authShape.kind) {
    case 'none':
    case 'body':
      return;
    case 'bearer':
      headers.set('authorization', `Bearer ${slot.secret}`);
      return;
    case 'header':
      headers.set(slot.authShape.header, slot.secret);
      return;
    case 'queryParam':
      url.searchParams.set(slot.authShape.param, slot.secret);
      return;
  }
}

const TEXT_SLOT_COLUMN: Record<
  string,
  'textProviderModelId' | 'textLightProviderModelId'
> = {
  piText: 'textProviderModelId',
  piTextLight: 'textLightProviderModelId'
};

// The provider_model this import bound to `slot`, mirroring the Rust pipeline
// bridge. (Cloud resolution is Tauri-only; standalone scripts use BYO providers.)
async function boundProviderModelId(
  db: Kysely<DB>,
  bookImportId: string,
  slot: string
): Promise<string | null> {
  const col = TEXT_SLOT_COLUMN[slot];
  if (!col) return null;
  const row = await db
    .selectFrom('bookImports')
    .select(col)
    .where('id', '=', bookImportId)
    .executeTakeFirst();
  return (row?.[col] as string | null | undefined) ?? null;
}

async function loadProviderRow(db: Kysely<DB>, providerModelId: string) {
  return db
    .selectFrom('providerModels')
    .innerJoin('providers', 'providers.id', 'providerModels.providerId')
    .select([
      'providerModels.modelKey',
      'providerModels.reasoning',
      'providers.type as providerType',
      'providers.baseUrl',
      'providers.authShape',
      'providers.secret',
      'providers.secretEnvVar',
      'providers.secretPriority'
    ])
    .where('providerModels.id', '=', providerModelId)
    .executeTakeFirst();
}

async function resolveSlot(
  db: Kysely<DB>,
  bookImportId: string,
  slot: string
): Promise<ResolvedSlot | null> {
  const pmid = await boundProviderModelId(db, bookImportId, slot);
  if (!pmid) return null;
  const match = await loadProviderRow(db, pmid);
  if (!match) return null;
  if (!match.baseUrl) {
    throw new Error(`slot "${slot}": provider missing baseUrl`);
  }

  if (match.secretPriority !== 'env') {
    throw new Error(
      `slot "${slot}": secretPriority="${match.secretPriority}" not supported by local-bridge ` +
        `(no keychain decryption); only env-var secrets work in standalone scripts`
    );
  }
  const envVar = match.secretEnvVar;
  if (!envVar) {
    throw new Error(`slot "${slot}": provider has no secretEnvVar`);
  }
  const secret = Deno.env.get(envVar) ?? null;

  return {
    providerType: match.providerType,
    modelId: match.modelKey,
    reasoning: match.reasoning ?? null,
    baseUrl: match.baseUrl,
    authShape: match.authShape,
    secret
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value ?? null), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

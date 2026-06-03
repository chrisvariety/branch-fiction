import type { Context } from 'hono';

import type { ResolvedProvider } from './tokens';

const STRIP_HEADERS = new Set([
  'host',
  'authorization',
  'x-goog-api-key',
  'content-length',
  'connection'
]);

// Mirrors `src-tauri/src/extension_proxy.rs`.
export async function proxyToProvider(
  c: Context,
  label: string,
  resolved: ResolvedProvider,
  rest: string
): Promise<Response> {
  const target = buildTargetUrl(resolved.baseURL, rest, c.req.url);
  const outbound = sanitizeHeaders(c.req.raw.headers, resolved);
  if (resolved.apiKey) {
    applyAuth(resolved, outbound, target);
  }
  const init: RequestInit = {
    method: c.req.method,
    headers: outbound,
    redirect: 'manual'
  };
  // Buffer body: undici needs a replayable source and throws on streamed bodies.
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = await c.req.raw.arrayBuffer();
  }
  if (resolved.auth.kind === 'body') {
    const rewrite = applyBodyAuth(
      resolved.auth.field,
      resolved.apiKey ?? '',
      c.req.method,
      outbound,
      init.body as ArrayBuffer | undefined
    );
    if (!rewrite.ok) {
      return new Response(rewrite.error, { status: 400 });
    }
    init.body = rewrite.body;
  }
  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    console.error(`[proxy] ${label} ${c.req.method} ${target} -> send error:`, e);
    throw e;
  }
  console.log(`[proxy] ${label} ${c.req.method} ${target} -> ${upstream.status}`);
  // Stream response back unchanged except for hop-by-hop headers.
  const headers = new Headers(upstream.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
  return new Response(upstream.body, { status: upstream.status, headers });
}

function buildTargetUrl(baseURL: string, rest: string, reqUrl: string): URL {
  const trimmedBase = baseURL.replace(/\/+$/, '');
  const trimmedRest = rest.replace(/^\/+/, '');
  const joined = trimmedRest ? `${trimmedBase}/${trimmedRest}` : trimmedBase;
  const url = new URL(joined);
  // Carry through caller's query string.
  const callerQuery = new URL(reqUrl).search;
  if (callerQuery) {
    const callerParams = new URLSearchParams(callerQuery);
    for (const [k, v] of callerParams) {
      url.searchParams.append(k, v);
    }
  }
  return url;
}

function sanitizeHeaders(incoming: Headers, resolved: ResolvedProvider): Headers {
  const out = new Headers();
  const stripCustom =
    resolved.auth.kind === 'header' ? resolved.auth.header.toLowerCase() : null;
  for (const [name, value] of incoming) {
    const n = name.toLowerCase();
    if (STRIP_HEADERS.has(n)) continue;
    if (stripCustom && n === stripCustom) continue;
    out.append(name, value);
  }
  return out;
}

function applyAuth(resolved: ResolvedProvider, headers: Headers, url: URL): void {
  const apiKey = resolved.apiKey ?? '';
  switch (resolved.auth.kind) {
    case 'none':
      return;
    case 'bearer':
      headers.set('authorization', `Bearer ${apiKey}`);
      return;
    case 'header':
      headers.set(resolved.auth.header, apiKey);
      return;
    case 'queryParam':
      url.searchParams.set(resolved.auth.param, apiKey);
      return;
    case 'body':
      // Body rewriting happens after the request body is buffered.
      return;
  }
}

type BodyAuthResult = { ok: true; body: string } | { ok: false; error: string };

function applyBodyAuth(
  field: string,
  apiKey: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined
): BodyAuthResult {
  if (method === 'GET' || method === 'HEAD' || !body || body.byteLength === 0) {
    return { ok: false, error: 'body auth requires a JSON request body' };
  }
  const contentType = headers.get('content-type') ?? '';
  if (contentType && !/^application\/json\b/i.test(contentType)) {
    return { ok: false, error: 'body auth requires application/json content-type' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch (e) {
    return { ok: false, error: `body auth: invalid json: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'body auth: JSON root must be an object' };
  }
  (parsed as Record<string, unknown>)[field] = apiKey;
  headers.set('content-type', 'application/json');
  return { ok: true, body: JSON.stringify(parsed) };
}

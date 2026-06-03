import type { BookImportUpdate } from '@/app/lib/db/types';

export type SlotInfo = {
  providerType: string;
  modelId: string;
  reasoning?: string | null;
};

type BookImportUpdateRequest = BookImportUpdate & {
  incrementErrorCount?: boolean;
};

let bridgePort: number | null = null;
let bridgeToken: string | null = null;

export function configureBridge(port: number, token: string): void {
  bridgePort = port;
  bridgeToken = token;
}

function bridgeBaseUrl(): string {
  if (bridgePort === null || bridgeToken === null) {
    throw new Error('bridge not configured — host should call init() first');
  }
  return `http://127.0.0.1:${bridgePort}/v1/worker/${bridgeToken}`;
}

export function bridgeProxyBaseUrl(): string {
  if (bridgePort === null || bridgeToken === null) {
    throw new Error('bridge not configured — host should call init() first');
  }
  return `http://127.0.0.1:${bridgePort}/system-proxy/${bridgeToken}`;
}

export async function fetchSlotInfo(): Promise<Record<string, SlotInfo>> {
  return await bridgeRequest<Record<string, SlotInfo>>('GET', '/slots/resolve');
}

export async function bridgeSyncImport(): Promise<void> {
  await bridgeRequest<void>('POST', '/import/sync');
}

export async function bridgeGetBookImport<T>(): Promise<T | null> {
  return await bridgeRequest<T | null>('GET', '/book-import');
}

export async function bridgeUpdateBookImport(
  fields: BookImportUpdateRequest
): Promise<void> {
  await bridgeRequest<void>('POST', '/book-import/update', fields);
}

export async function bridgeGetBook<T>(id: string): Promise<T | null> {
  return await bridgeRequest<T | null>('GET', `/books/${encodeURIComponent(id)}`);
}

export async function bridgeCreateBook<T>(req: {
  id: string;
  userId: string;
  shareCode: string;
  baseSlug: string;
  title: string;
  isbn: string | null;
  language: string | null;
  publisher: string | null;
  imageUrl: string | null;
}): Promise<T> {
  const result = await bridgeRequest<T>('POST', '/books', req);
  if (result === null) throw new Error('createBook returned null');
  return result;
}

export async function bridgeUpdateBook(
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  await bridgeRequest<void>('POST', `/books/${encodeURIComponent(id)}/update`, fields);
}

async function bridgeRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${bridgeBaseUrl()}${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`bridge ${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

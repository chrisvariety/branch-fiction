// fetches and persists a newer pi-ai model catalog than the baked-in one

import { applyModelsCatalog } from '@branch-fiction/extension-sdk/models-catalog';
import { isTauri } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const CATALOG_URL = 'https://cloud.branchfiction.com/catalog/models';
// in storage/ so the sidecar workers can already read it
const CATALOG_FILE = 'models-catalog.json';
// keeps the server ETag so unchanged refreshes are bodyless 304s
const META_FILE = 'models-catalog.meta.json';

type CatalogMeta = { etag: string | null; fetchedAt: string };

async function storagePath(file: string): Promise<string> {
  return join(await appDataDir(), 'storage', file);
}

// never throws: missing/corrupt file → baked-in catalog
export async function loadSavedModelsCatalog(): Promise<void> {
  if (!isTauri()) return;
  try {
    const path = await storagePath(CATALOG_FILE);
    if (!(await exists(path))) return;
    applyModelsCatalog(JSON.parse(await readTextFile(path)));
  } catch (e) {
    console.warn('models catalog: failed to load saved catalog', e);
  }
}

async function readMeta(): Promise<CatalogMeta | null> {
  try {
    const path = await storagePath(META_FILE);
    if (!(await exists(path))) return null;
    return JSON.parse(await readTextFile(path)) as CatalogMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: CatalogMeta): Promise<void> {
  await writeTextFile(await storagePath(META_FILE), JSON.stringify(meta));
}

export async function refreshModelsCatalog(): Promise<{ updated: boolean }> {
  const meta = await readMeta();
  const headers = new Headers();
  if (meta?.etag) headers.set('if-none-match', meta.etag);

  const res = await fetch(CATALOG_URL, { headers });
  if (res.status === 304) {
    await writeMeta({ etag: meta?.etag ?? null, fetchedAt: new Date().toISOString() });
    return { updated: false };
  }
  if (!res.ok) {
    throw new Error(`Model catalog server returned ${res.status}`);
  }

  const body = await res.text();
  // validates and throws on garbage before we persist anything
  applyModelsCatalog(JSON.parse(body));

  const dir = await join(await appDataDir(), 'storage');
  await mkdir(dir, { recursive: true });
  await writeTextFile(await storagePath(CATALOG_FILE), body);
  await writeMeta({
    etag: res.headers.get('etag'),
    fetchedAt: new Date().toISOString()
  });
  return { updated: true };
}

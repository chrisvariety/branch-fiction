import type { KnownProvider } from '@earendil-works/pi-ai';
import { invoke, isTauri } from '@tauri-apps/api/core';

import type { ProviderAuthShape } from '../db/types';

// Slot definitions re-exported from the SDK so extension authors share the same source of truth.
export { isKnownSlot, SLOT_LABELS } from '@branch-fiction/extension-sdk';
export type { Slot } from '@branch-fiction/extension-sdk';

export type TestProviderResult = { ok: true } | { ok: false; error: string };

// shortcut to avoid repeating provider types as the definitive list lives in rust
export type ProviderTypeKey = string;

export type ProviderCatalogEntry = {
  type: ProviderTypeKey;
  name: string;
  baseUrl: string;
  authShape: ProviderAuthShape;
  piProvider: KnownProvider | null;
  apiKeyPlaceholder: string;
  envVarPlaceholder: string;
  isCompatibleVariant: boolean;
  requiresBaseUrl: boolean;
};

let catalogCache: ProviderCatalogEntry[] | null = null;

export async function loadProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  if (catalogCache) return catalogCache;
  // Phone-share has no Tauri bridge; LLM calls proxy server-side.
  if (!isTauri()) return [];
  const entries = await invoke<ProviderCatalogEntry[]>('get_provider_catalog');
  catalogCache = entries;
  return entries;
}

function requireCatalog(): ProviderCatalogEntry[] {
  if (!catalogCache) {
    throw new Error(
      'Provider catalog not loaded — call loadProviderCatalog() during app boot'
    );
  }
  return catalogCache;
}

export function getProviderCatalog(): ProviderCatalogEntry[] {
  return requireCatalog();
}

export function getProviderEntry(type: string): ProviderCatalogEntry | null {
  return requireCatalog().find((p) => p.type === type) ?? null;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function authShapesEqual(a: ProviderAuthShape, b: ProviderAuthShape): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'header' && b.kind === 'header') return a.header === b.header;
  if (a.kind === 'queryParam' && b.kind === 'queryParam') return a.param === b.param;
  if (a.kind === 'body' && b.kind === 'body') return a.field === b.field;
  return true;
}

export function providerMatchesOriginAndAuth(
  provider: { baseUrl: string | null; type: string; authShape: ProviderAuthShape },
  baseURL: string,
  auth: ProviderAuthShape
): boolean {
  const target = originOf(baseURL);
  if (!target) return false;
  const effectiveBase =
    provider.baseUrl ?? getProviderEntry(provider.type)?.baseUrl ?? null;
  if (!effectiveBase) return false;
  return originOf(effectiveBase) === target && authShapesEqual(provider.authShape, auth);
}

export function getProviderEntryByOriginAndAuth(
  baseURL: string,
  auth: ProviderAuthShape
): ProviderCatalogEntry | null {
  const target = originOf(baseURL);
  if (!target) return null;
  return (
    requireCatalog().find(
      (p) =>
        p.baseUrl !== '' &&
        originOf(p.baseUrl) === target &&
        authShapesEqual(p.authShape, auth)
    ) ?? null
  );
}

// runtime overlay for pi-ai's baked-in model catalog; lookups prefer the overlay

import type { Api, KnownProvider, Model } from '@earendil-works/pi-ai';
import { getModel, getModels, getProviders } from '@earendil-works/pi-ai';

export type ModelsCatalogJson = Record<string, Record<string, unknown>>;

type CatalogState = {
  models: Map<string, Map<string, Model<Api>>>;
  version: number;
};

// Symbol.for so every copy of this module in the isolate shares one state
const GLOBAL_KEY = Symbol.for('branch-fiction.models-catalog');

type GlobalWithCatalog = { [GLOBAL_KEY]?: CatalogState };

function getCatalogState(): CatalogState | undefined {
  return (globalThis as GlobalWithCatalog)[GLOBAL_KEY];
}

function isValidModel(value: unknown): value is Model<Api> {
  if (value === null || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    typeof m.api === 'string' &&
    typeof m.provider === 'string' &&
    typeof m.baseUrl === 'string'
  );
}

// throws if nothing valid remains, so callers keep the previous overlay
export function applyModelsCatalog(json: unknown): number {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('models catalog must be an object keyed by provider');
  }
  const models = new Map<string, Map<string, Model<Api>>>();
  let count = 0;
  for (const [provider, entries] of Object.entries(json as ModelsCatalogJson)) {
    if (entries === null || typeof entries !== 'object') continue;
    const providerModels = new Map<string, Model<Api>>();
    for (const [id, model] of Object.entries(entries)) {
      if (isValidModel(model)) {
        providerModels.set(id, model);
        count++;
      }
    }
    if (providerModels.size > 0) models.set(provider, providerModels);
  }
  if (count === 0) throw new Error('models catalog contained no valid models');
  const prev = getCatalogState();
  (globalThis as GlobalWithCatalog)[GLOBAL_KEY] = {
    models,
    version: (prev?.version ?? 0) + 1
  };
  return count;
}

// bumps per applied catalog; 0 means baked data only
export function modelsCatalogVersion(): number {
  return getCatalogState()?.version ?? 0;
}

export function getCatalogModel(
  provider: string,
  modelId: string
): Model<Api> | undefined {
  const overlay = getCatalogState()?.models.get(provider)?.get(modelId);
  if (overlay) return overlay;
  return getModel(provider as KnownProvider, modelId as never) as Model<Api> | undefined;
}

// overlay first, then baked-only leftovers so configured models keep resolving
export function getCatalogModels(provider: string): Model<Api>[] {
  const overlay = getCatalogState()?.models.get(provider);
  const baked = getModels(provider as KnownProvider) as Model<Api>[];
  if (!overlay) return baked;
  const merged = Array.from(overlay.values());
  for (const m of baked) {
    if (!overlay.has(m.id)) merged.push(m);
  }
  return merged;
}

export function getCatalogProviders(): string[] {
  const state = getCatalogState();
  const baked = getProviders() as string[];
  if (!state) return baked;
  return Array.from(new Set([...state.models.keys(), ...baked]));
}

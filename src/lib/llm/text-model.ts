import { getModels } from '@earendil-works/pi-ai';

import { getProviderEntry } from './providers';

type SlotModel = { modelKey: string };
type TextProviderLike = { type: string; createdAt: string; models: SlotModel[] };

// Named providers must appear in pi-AI's text registry (filters out image-only models); generic providers are trusted.
function isTextModel(providerType: string, modelKey: string): boolean {
  const piProvider = getProviderEntry(providerType)?.piProvider ?? null;
  if (!piProvider) return true;
  const known = getModels(piProvider);
  if (known.length === 0) return true;
  return known.some((m) => m.id === modelKey);
}

// The first text-capable model for a provider, or null.
export function primaryTextModel<M extends SlotModel>(provider: {
  type: string;
  models: M[];
}): M | null {
  return provider.models.find((m) => isTextModel(provider.type, m.modelKey)) ?? null;
}

// Providers that can back a text role: non-custom and with a usable text model.
export function selectableTextProviders<P extends TextProviderLike>(providers: P[]): P[] {
  return providers.filter((p) => p.type !== 'custom' && primaryTextModel(p) !== null);
}

// The default pick: the most recently added selectable provider.
export function defaultTextProvider<P extends TextProviderLike>(
  providers: P[]
): P | null {
  const candidates = selectableTextProviders(providers);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, p) => (p.createdAt > latest.createdAt ? p : latest));
}

export function hasUsableTextProvider<P extends TextProviderLike>(
  providers: P[]
): boolean {
  return selectableTextProviders(providers).length > 0;
}

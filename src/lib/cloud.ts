import type { ProviderAuthShape, ReasoningLevel } from './db/types';

export const CLOUD_API = 'https://cloud.branchfiction.com/users';
export const CLOUD_TOKEN = 'https://cloud.branchfiction.com/token';
export const CLOUD_CATALOG = 'https://cloud.branchfiction.com/catalog';
export const CLOUD_ESTIMATE = 'https://cloud.branchfiction.com/estimate';

export const CLOUD_PROVIDER_TYPE = 'cloud';

export type CloudProvider = {
  origin: string;
  proxyBaseUrl: string;
  auth: ProviderAuthShape;
};

export type CloudSlot = {
  origin: string;
  modelKey: string;
  reasoning?: ReasoningLevel;
};

export type CloudCatalogResponse = {
  providers: CloudProvider[];
  slots: Record<string, CloudSlot>;
};

export type CloudTokenResponse = {
  token: string;
};

export async function fetchCloudCatalog(): Promise<CloudCatalogResponse> {
  const res = await fetch(CLOUD_CATALOG);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Failed to fetch cloud catalog: ${body.error ?? res.statusText}`);
  }
  return (await res.json()) as CloudCatalogResponse;
}

export async function fetchCloudToken(userId: string): Promise<CloudTokenResponse> {
  const res = await fetch(CLOUD_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Failed to fetch cloud token: ${body.error ?? res.statusText}`);
  }
  return (await res.json()) as CloudTokenResponse;
}

export async function fetchCloudEstimate(bookTokens: number): Promise<number | null> {
  const res = await fetch(CLOUD_ESTIMATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookTokens })
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { amount: number | null };
  return data.amount;
}

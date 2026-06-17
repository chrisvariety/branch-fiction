import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';

import type { WorldModel } from '@/lib/db/types';

export const MODEL_NAMES: Record<WorldModel, string> = {
  helios: 'helios',
  lingbot: 'lingbot'
};

const TOKEN_LIFETIME_SECONDS = 3600;

// Mints a short-lived Reactor JWT through the host proxy, which injects the rk_ key.
export async function getReactorJwt(): Promise<string> {
  const provider = window.extensionSDK.providers['reactor_token'];
  if (!provider) throw new Error('reactor_token provider is not configured');
  const res = await fetch(`${provider.proxyBaseURL}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: TOKEN_LIFETIME_SECONDS })
  });
  if (!res.ok) {
    throw new Error(`Reactor token mint failed: ${res.status} ${await res.text()}`);
  }
  const { jwt } = (await res.json()) as { jwt: string };
  return jwt;
}

// The seed image is stored as a file:// asset URL; resolve to the host URL and fetch its bytes.
export async function fetchSeedImageBlob(seedImageUrl: string): Promise<Blob> {
  const hostUrl = transformImageUrl(seedImageUrl);
  const res = await fetch(hostUrl);
  if (!res.ok) throw new Error(`Failed to load seed image: ${res.status}`);
  return res.blob();
}

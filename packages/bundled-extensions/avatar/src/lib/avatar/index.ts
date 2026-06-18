import { LEMONSLICE_PROVIDER, lemonsliceAvatarAdapter } from './lemonslice';
import type { AvatarAdapter } from './types';

const LEMONSLICE_BASE = 'https://lemonslice.com';

export function getAvatarAdapter(provider: ProviderBinding): AvatarAdapter {
  if (provider.baseURL === LEMONSLICE_BASE) return lemonsliceAvatarAdapter;
  throw new Error(`Unsupported avatar provider: ${provider.baseURL}`);
}

export { LEMONSLICE_PROVIDER };
export type { AvatarAdapter, AvatarSession, StartSessionOptions } from './types';

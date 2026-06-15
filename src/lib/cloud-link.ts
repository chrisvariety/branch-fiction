import { invoke } from '@tauri-apps/api/core';

import { autoConfigureCloudEligibleExtensions } from '@/extensions/install';

export async function linkCloudAccount(externalId: string) {
  try {
    await invoke('link_cloud_account', { externalId });
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
  await autoConfigureCloudEligibleExtensions();
}

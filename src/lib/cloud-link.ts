import { invoke } from '@tauri-apps/api/core';

import { autoConfigureCloudEligibleExtensions } from '@/extensions/install';

export async function linkCloudAccount(externalId: string) {
  await invoke('link_cloud_account', { externalId });
  await autoConfigureCloudEligibleExtensions();
}

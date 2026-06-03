import { invoke } from '@tauri-apps/api/core';

export async function removeProvider(id: string): Promise<void> {
  await invoke('remove_provider', { providerId: id });
}

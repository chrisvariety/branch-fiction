import { invoke, isTauri } from '@tauri-apps/api/core';

export { extensionSdkSource } from '@branch-fiction/extension-sdk/sdk-source';
import { extensionSdkSource } from '@branch-fiction/extension-sdk/sdk-source';

let registered: Promise<void> | null = null;

// Phone-share has no Tauri bridge; desktop already pushed SDK source at boot.
export function registerExtensionSdkSource(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (registered) return registered;
  registered = invoke('set_extension_sdk_source', { source: extensionSdkSource() }).then(
    () => undefined
  );
  return registered;
}

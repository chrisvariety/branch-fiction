// Ambient bridge: makes the extension SDK / host surface available without
// imports. Pulls the canonical types from @branch-fiction/extension-sdk.

import type {
  ExtensionCtx as SdkExtensionCtx,
  ExtensionHost as SdkExtensionHost,
  ExtensionProviderBinding as SdkProviderBinding,
  ExtensionSDK as SdkExtensionSDK
} from '@branch-fiction/extension-sdk';

declare global {
  type ExtensionCtx = SdkExtensionCtx;
  type ProviderBinding = SdkProviderBinding;
  type ExtensionSDK = SdkExtensionSDK;
  type ExtensionHost = SdkExtensionHost;

  // Runtime global injected by the SDK script at /extension-sdk.js.
  // Using the SDK's wire name (`extensionSDK`) so live code and types agree.
  interface Window {
    extensionSDK: SdkExtensionSDK;
  }
  var extensionSDK: SdkExtensionSDK;
  var host: SdkExtensionHost;
}

export {};

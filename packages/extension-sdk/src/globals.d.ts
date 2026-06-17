// Internal ambient bridge for the injected runtime globals; not emitted to dist.
import type {
  ExtensionCtx as SdkExtensionCtx,
  ExtensionHost as SdkExtensionHost,
  ExtensionProviderBinding as SdkProviderBinding,
  ExtensionSDK as SdkExtensionSDK
} from './sdk-source';

declare global {
  type ExtensionCtx = SdkExtensionCtx;
  type ProviderBinding = SdkProviderBinding;
  type ExtensionSDK = SdkExtensionSDK;
  type ExtensionHost = SdkExtensionHost;

  interface Window {
    extensionSDK: SdkExtensionSDK;
  }
  var extensionSDK: SdkExtensionSDK;
  var host: SdkExtensionHost;

  // Minimal surface env-soft patches; full types live in @types/deno in consumers.
  var Deno: {
    env: {
      get(key: string): string | undefined;
      has(key: string): boolean;
      toObject(): Record<string, string>;
      set(key: string, value: string): void;
      delete(key: string): void;
    };
  };
}

export {};

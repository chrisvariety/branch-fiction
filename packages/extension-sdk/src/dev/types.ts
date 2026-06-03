import type { ProviderAuthShape } from '../types';

export type DevProviderBindingOptions = {
  kind: 'options';
  // Index into the requirement's `options[]` array. (TODO: rename? `useOptionsIndex` ?)
  useIndex: number;
  fullURL?: string;
  apiKey?: string;
};

export type DevProviderBindingSlot = {
  kind: 'useSlot';
  providerType: string;
  modelKey: string;
  baseURL: string;
  auth: ProviderAuthShape;
  apiKey?: string;
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};

export type DevProviderBinding = DevProviderBindingOptions | DevProviderBindingSlot;

export type DevConfig = {
  bookId?: string;
  bridgeToken?: string;
  config?: Record<string, unknown>;
  providers?: Record<string, DevProviderBinding>;
};

export type DevRuntimeOptions = {
  // Absolute path to the extension source directory (where manifest.json lives).
  extensionDir: string;
  // Port the Hono server should listen on.
  hostPort: number;
  // Vite dev server origin (e.g. http://localhost:5173) — used by the setup UI to hand the iframe its URL.
  viteOrigin: string;
  // Absolute path to the extension-host Deno bundle.
  extensionHostBundle: string;
  // Path or PATH-name of the deno binary used to run worker tasks.
  denoBin: string;
  // Bridge-prepared paths owned by the running Tauri app.
  dbPath: string;
  dataDir: string;
  assetsDir: string;
  // Where dev.config.json lives. Defaults to <extensionDir>/dev.config.json.
  configPath?: string;
};

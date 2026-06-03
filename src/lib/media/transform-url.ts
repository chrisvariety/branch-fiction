import { invoke, isTauri } from '@tauri-apps/api/core';

let tauriHttpPort: number | null = null;

// Resolves the embedded axum server's port from Tauri or window.location.
export async function bootstrapHttpPort(): Promise<void> {
  if (!isTauri()) return;
  tauriHttpPort = await invoke<number>('get_http_port');
}

export async function getHttpPort(): Promise<number> {
  if (tauriHttpPort != null) return tauriHttpPort;
  if (isTauri()) {
    tauriHttpPort = await invoke<number>('get_http_port');
    return tauriHttpPort;
  }
  return Number(window.location.port) || 80;
}

function resolveAssetBase(): string {
  if (isTauri()) {
    if (tauriHttpPort == null) {
      throw new Error(
        'http port not bootstrapped — call bootstrapHttpPort() before mount'
      );
    }
    return `http://localhost:${tauriHttpPort}`;
  }
  return `${window.location.protocol}//${window.location.host}`;
}

export function transformImageUrl(imageUrl: string) {
  const { bucket, key } = parseStorageUrl(imageUrl);
  return `${resolveAssetBase()}/assets/${bucket}/${key}`;
}

export function extensionAssetUrl(extensionId: string, path: string): string {
  return `${resolveAssetBase()}/extension-assets/${encodeURIComponent(extensionId)}/${path}`;
}

export function cropToFace(imageUrl: string) {
  return transformImageUrl(imageUrl);
}

export function transformVideoUrl(videoUrl: string) {
  return transformImageUrl(videoUrl);
}

function parseStorageUrl(url: string): { bucket: string; key: string } {
  const parsed = new URL(url);
  if (parsed.protocol !== 'file:') {
    throw new Error(`Invalid storage URL protocol: ${url}`);
  }
  return {
    bucket: parsed.hostname,
    key: parsed.pathname.slice(1)
  };
}

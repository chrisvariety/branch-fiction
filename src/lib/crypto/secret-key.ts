import { invoke } from '@tauri-apps/api/core';

let cachedKey: CryptoKey | null = null;
let loading: Promise<CryptoKey> | null = null;

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function loadRaw(): Promise<Uint8Array> {
  // Rust returns Vec<u8>; serde encodes as a JSON number array over IPC.
  const bytes = await invoke<number[]>('get_or_create_secret_key');
  return new Uint8Array(bytes);
}

export async function getSecretKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (!loading) loading = loadRaw().then(importKey);
  cachedKey = await loading;
  return cachedKey;
}

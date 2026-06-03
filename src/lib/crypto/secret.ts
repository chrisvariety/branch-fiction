import { decode as decodeBase64, encode as encodeBase64 } from '@stablelib/base64';

import { getSecretKey } from './secret-key';

const NONCE_BYTES = 12;

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getSecretKey();
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      new TextEncoder().encode(plaintext)
    )
  );
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return encodeBase64(blob);
}

export async function decryptSecret(stored: string): Promise<string> {
  const key = await getSecretKey();
  const blob = new Uint8Array(decodeBase64(stored));
  const nonce = blob.subarray(0, NONCE_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

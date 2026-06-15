use aes_gcm::Aes256Gcm;
use aes_gcm::aead::{Aead, KeyInit, Nonce as AeadNonce};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use tauri::AppHandle;

use crate::secret_key::load_or_create_secret_key;

const NONCE_BYTES: usize = 12;

fn cipher_for(app: &AppHandle) -> Result<Aes256Gcm, String> {
    let key_bytes = load_or_create_secret_key(app)?;
    Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("aes-gcm key length: {e}"))
}

// AES-256-GCM with a random 12-byte nonce prefix; matches the WebCrypto format from secret.ts.
pub fn encrypt_provider_secret(app: &AppHandle, plaintext: &str) -> Result<String, String> {
    let cipher = cipher_for(app)?;
    let mut nonce_bytes = [0u8; NONCE_BYTES];
    getrandom::fill(&mut nonce_bytes).map_err(|e| format!("nonce rng: {e}"))?;
    let nonce = AeadNonce::<Aes256Gcm>::try_from(&nonce_bytes[..])
        .map_err(|e| format!("aes-gcm nonce length: {e}"))?;
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("aes-gcm encrypt: {e}"))?;
    let mut blob = Vec::with_capacity(NONCE_BYTES + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(B64.encode(blob))
}

pub fn decrypt_provider_secret(app: &AppHandle, stored: &str) -> Result<String, String> {
    let blob = B64
        .decode(stored)
        .map_err(|e| format!("secret base64 decode: {e}"))?;
    if blob.len() < NONCE_BYTES + 16 {
        return Err("secret blob too short".to_string());
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_BYTES);
    let cipher = cipher_for(app)?;
    let nonce = AeadNonce::<Aes256Gcm>::try_from(nonce_bytes)
        .map_err(|e| format!("aes-gcm nonce length: {e}"))?;
    let plaintext = cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|e| format!("aes-gcm decrypt: {e}"))?;
    String::from_utf8(plaintext).map_err(|e| format!("secret utf8: {e}"))
}

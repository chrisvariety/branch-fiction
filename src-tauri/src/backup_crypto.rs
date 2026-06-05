use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use chacha20poly1305::aead::stream::{DecryptorBE32, EncryptorBE32};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit};
use hkdf::Hkdf;
use sha2::Sha256;

// Format: MAGIC || 7-byte nonce prefix || 64KiB STREAM chunks (ChaCha20-Poly1305).
const MAGIC: &[u8; 8] = b"BFCBKUP1";
const NONCE_LEN: usize = 7;
const TAG_LEN: usize = 16;
const CHUNK: usize = 64 * 1024;

pub(crate) fn generate_recovery_phrase() -> Result<String, String> {
    let mut entropy = [0u8; 16];
    getrandom::fill(&mut entropy).map_err(|e| format!("entropy: {e}"))?;
    let mnemonic =
        bip39::Mnemonic::from_entropy(&entropy).map_err(|e| format!("mnemonic: {e}"))?;
    Ok(mnemonic.to_string())
}

/// Parses a user-entered phrase, returning its canonical form.
pub(crate) fn normalize_recovery_phrase(phrase: &str) -> Result<String, String> {
    Ok(parse_phrase(phrase)?.to_string())
}

pub(crate) fn key_fingerprint(phrase: &str) -> Result<String, String> {
    let mut out = [0u8; 8];
    derive(phrase, b"bfbackup-fingerprint-v1", &mut out)?;
    Ok(out.iter().map(|b| format!("{b:02x}")).collect())
}

fn parse_phrase(phrase: &str) -> Result<bip39::Mnemonic, String> {
    let normalized = phrase
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    bip39::Mnemonic::parse(&normalized).map_err(|_| "invalid recovery key".to_string())
}

fn derive(phrase: &str, info: &[u8], out: &mut [u8]) -> Result<(), String> {
    let entropy = parse_phrase(phrase)?.to_entropy();
    Hkdf::<Sha256>::new(None, &entropy)
        .expand(info, out)
        .map_err(|e| format!("hkdf: {e}"))
}

fn cipher(phrase: &str) -> Result<ChaCha20Poly1305, String> {
    let mut key = [0u8; 32];
    derive(phrase, b"bfbackup-key-v1", &mut key)?;
    Ok(ChaCha20Poly1305::new((&key).into()))
}

fn read_full(r: &mut impl Read, buf: &mut [u8]) -> Result<usize, String> {
    let mut n = 0;
    while n < buf.len() {
        let m = r.read(&mut buf[n..]).map_err(|e| format!("read: {e}"))?;
        if m == 0 {
            break;
        }
        n += m;
    }
    Ok(n)
}

pub(crate) fn encrypt_file(src: &Path, dest: &Path, phrase: &str) -> Result<(), String> {
    let cipher = cipher(phrase)?;
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|e| format!("nonce: {e}"))?;
    let mut enc = EncryptorBE32::from_aead(cipher, (&nonce).into());

    let mut reader =
        BufReader::new(File::open(src).map_err(|e| format!("open {}: {e}", src.display()))?);
    let mut writer =
        BufWriter::new(File::create(dest).map_err(|e| format!("create {}: {e}", dest.display()))?);
    writer.write_all(MAGIC).map_err(|e| format!("write: {e}"))?;
    writer.write_all(&nonce).map_err(|e| format!("write: {e}"))?;

    let mut cur = vec![0u8; CHUNK];
    let mut cur_len = read_full(&mut reader, &mut cur)?;
    loop {
        let mut next = vec![0u8; CHUNK];
        let next_len = read_full(&mut reader, &mut next)?;
        if next_len == 0 {
            let ct = enc
                .encrypt_last(&cur[..cur_len])
                .map_err(|_| "encryption failed".to_string())?;
            writer.write_all(&ct).map_err(|e| format!("write: {e}"))?;
            break;
        }
        let ct = enc
            .encrypt_next(&cur[..cur_len])
            .map_err(|_| "encryption failed".to_string())?;
        writer.write_all(&ct).map_err(|e| format!("write: {e}"))?;
        cur = next;
        cur_len = next_len;
    }
    writer.flush().map_err(|e| format!("flush: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(len: usize) {
        let dir = std::env::temp_dir().join(format!("bfcrypto-test-{len}"));
        std::fs::create_dir_all(&dir).unwrap();
        let plain = dir.join("plain");
        let enc = dir.join("enc");
        let out = dir.join("out");

        let data: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
        std::fs::write(&plain, &data).unwrap();

        let phrase = generate_recovery_phrase().unwrap();
        encrypt_file(&plain, &enc, &phrase).unwrap();
        decrypt_file(&enc, &out, &phrase).unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), data);

        let other = generate_recovery_phrase().unwrap();
        assert!(decrypt_file(&enc, &out, &other).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn roundtrips() {
        roundtrip(0);
        roundtrip(10);
        roundtrip(CHUNK);
        roundtrip(CHUNK * 3 + 17);
    }

    #[test]
    fn phrase_normalizes_and_fingerprints() {
        let phrase = generate_recovery_phrase().unwrap();
        let shouty = phrase.to_uppercase().replace(' ', "  ");
        assert_eq!(normalize_recovery_phrase(&shouty).unwrap(), phrase);
        assert_eq!(
            key_fingerprint(&shouty).unwrap(),
            key_fingerprint(&phrase).unwrap()
        );
        assert!(normalize_recovery_phrase("not a real phrase").is_err());
    }
}

pub(crate) fn decrypt_file(src: &Path, dest: &Path, phrase: &str) -> Result<(), String> {
    let cipher = cipher(phrase)?;
    let mut reader =
        BufReader::new(File::open(src).map_err(|e| format!("open {}: {e}", src.display()))?);

    let mut magic = [0u8; MAGIC.len()];
    let mut nonce = [0u8; NONCE_LEN];
    if read_full(&mut reader, &mut magic)? != magic.len()
        || &magic != MAGIC
        || read_full(&mut reader, &mut nonce)? != nonce.len()
    {
        return Err("not an encrypted Branch Fiction backup".into());
    }
    let mut dec = DecryptorBE32::from_aead(cipher, (&nonce).into());

    let mut writer =
        BufWriter::new(File::create(dest).map_err(|e| format!("create {}: {e}", dest.display()))?);
    let bad_key = || "wrong recovery key or corrupted backup".to_string();

    let mut cur = vec![0u8; CHUNK + TAG_LEN];
    let mut cur_len = read_full(&mut reader, &mut cur)?;
    loop {
        let mut next = vec![0u8; CHUNK + TAG_LEN];
        let next_len = read_full(&mut reader, &mut next)?;
        if cur_len < TAG_LEN {
            return Err(bad_key());
        }
        if next_len == 0 {
            let pt = dec.decrypt_last(&cur[..cur_len]).map_err(|_| bad_key())?;
            writer.write_all(&pt).map_err(|e| format!("write: {e}"))?;
            break;
        }
        let pt = dec.decrypt_next(&cur[..cur_len]).map_err(|_| bad_key())?;
        writer.write_all(&pt).map_err(|e| format!("write: {e}"))?;
        cur = next;
        cur_len = next_len;
    }
    writer.flush().map_err(|e| format!("flush: {e}"))
}

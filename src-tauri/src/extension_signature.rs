use std::path::Path;

use sha2::{Digest, Sha256};
use ssh_key::{PublicKey, SshSig};

// First-party public key baked into the binary; sole trust anchor for first-party extensions.
const FIRST_PARTY_PUBKEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIANlDwdXvn8qrUDs95iiNCaXdr3kZpU9yw6d1tho5ggv branch-fiction";

// SSHSIG namespace; must match the `-n` passed to `ssh-keygen -Y sign`.
const SIG_NAMESPACE: &str = "branch-fiction-extension";

// Detached signature shipped alongside manifest.json at the extension root.
const SIG_FILENAME: &str = "extension.sig";

// Excluded paths must mirror copy_dir_filtered and the signing script so installed bytes match the signed digest.
fn is_excluded_dir(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "__MACOSX")
}

fn is_excluded_file(name: &str) -> bool {
    name == SIG_FILENAME || name == ".DS_Store" || name.starts_with("._")
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        out.push(char::from_digit((b & 0x0f) as u32, 16).unwrap());
    }
    out
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        // Inspect the link itself; never follow symlinks into the signed set.
        let lstat = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("lstat {}: {e}", path.display()))?;
        if lstat.file_type().is_symlink() {
            continue;
        }
        if lstat.is_dir() {
            if is_excluded_dir(&name) {
                continue;
            }
            collect(root, &path, out)?;
            continue;
        }
        if is_excluded_file(&name) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|e| format!("strip_prefix: {e}"))?
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        let contents = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        let hash = hex_lower(&Sha256::digest(&contents));
        out.push((rel, hash));
    }
    Ok(())
}

// SHA256SUMS-style manifest of every installed file, sorted by path bytes.
fn digest_message(dir: &Path) -> Result<String, String> {
    let mut files: Vec<(String, String)> = Vec::new();
    collect(dir, dir, &mut files)?;
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut msg = String::new();
    for (rel, hash) in &files {
        msg.push_str(hash);
        msg.push_str("  ");
        msg.push_str(rel);
        msg.push('\n');
    }
    Ok(msg)
}

// Absent = third-party (no Cloud); Valid = first-party (Cloud-eligible); Invalid = tamper signal (reject).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SignatureStatus {
    Absent,
    Valid,
    Invalid,
}

// Verify the detached first-party signature over an extension directory; purely local.
pub fn check_extension_signature(dir: &Path) -> SignatureStatus {
    let sig_path = dir.join(SIG_FILENAME);
    if !sig_path.exists() {
        return SignatureStatus::Absent;
    }
    let verified = (|| {
        let sig_text = std::fs::read_to_string(&sig_path).ok()?;
        let sig = sig_text.parse::<SshSig>().ok()?;
        if sig.namespace() != SIG_NAMESPACE {
            return None;
        }
        let pubkey = PublicKey::from_openssh(FIRST_PARTY_PUBKEY).ok()?;
        let msg = digest_message(dir).ok()?;
        pubkey.verify(SIG_NAMESPACE, msg.as_bytes(), &sig).ok()
    })()
    .is_some();
    if verified {
        SignatureStatus::Valid
    } else {
        SignatureStatus::Invalid
    }
}

// Advisory UI/cloud-slotting check; `commit_extension_install` re-derives authoritatively.
#[tauri::command(rename_all = "camelCase")]
pub fn verify_extension_signature_cmd(source_path: String) -> Result<SignatureStatus, String> {
    Ok(check_extension_signature(Path::new(&source_path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ext-sig-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Pins the digest format; must stay in lockstep with scripts/sign-extension.mjs.
    #[test]
    fn digest_format_ordering_and_exclusions() {
        let dir = scratch();
        std::fs::write(dir.join("manifest.json"), r#"{"id":"@x/y"}"#).unwrap();
        std::fs::create_dir_all(dir.join("dir")).unwrap();
        std::fs::write(dir.join("dir/a.txt"), "A").unwrap();
        std::fs::write(dir.join(SIG_FILENAME), "ignored").unwrap();
        std::fs::write(dir.join(".DS_Store"), "ignored").unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("node_modules/x.js"), "ignored").unwrap();

        let expected = concat!(
            "559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd  dir/a.txt\n",
            "5bf44d9e805aa42388513392e79d414d30892a9b5bf9ca3bbd2bbdcef156ccf4  manifest.json\n",
        );
        assert_eq!(digest_message(&dir).unwrap(), expected);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unsigned_dir_is_absent() {
        let dir = scratch();
        std::fs::write(dir.join("manifest.json"), r#"{"id":"@x/y"}"#).unwrap();
        assert_eq!(check_extension_signature(&dir), SignatureStatus::Absent);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn garbage_signature_is_invalid_not_absent() {
        let dir = scratch();
        std::fs::write(dir.join("manifest.json"), r#"{"id":"@x/y"}"#).unwrap();
        std::fs::write(dir.join(SIG_FILENAME), "not a real signature").unwrap();
        assert_eq!(check_extension_signature(&dir), SignatureStatus::Invalid);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

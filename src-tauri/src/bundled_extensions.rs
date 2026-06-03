use std::fs;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::extension_signature::{SignatureStatus, check_extension_signature};

/// Returns absolute paths to bundled extension dirs (each contains `manifest.json`).
#[tauri::command]
pub async fn list_bundled_extension_dirs(app: AppHandle) -> Result<Vec<String>, String> {
    let root = match app
        .path()
        .resolve("bundled-extensions", BaseDirectory::Resource)
    {
        Ok(p) => p,
        Err(e) => return Err(format!("resolve resource dir: {e}")),
    };
    if !root.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&root).map_err(|e| format!("read_dir {}: {e}", root.display()))?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let ft = entry.file_type().map_err(|e| format!("file_type: {e}"))?;
        if !ft.is_dir() {
            continue;
        }
        let dir = entry.path();
        if !dir.join("manifest.json").is_file() {
            continue;
        }
        // Invalid signature = tampered resource; absent is fine (bundled = trusted by construction).
        if check_extension_signature(&dir) == SignatureStatus::Invalid {
            eprintln!(
                "skipping bundled extension with invalid signature: {}",
                dir.display()
            );
            continue;
        }
        out.push(dir.to_string_lossy().into_owned());
    }
    Ok(out)
}

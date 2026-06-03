use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sqlx::Connection;
use tauri::{AppHandle, Manager};

use crate::db_path::open_main_db_rw;
use crate::extension_signature::SignatureStatus;
use crate::extension_slots::upsert_extension_provider;
use crate::provider_secret::encrypt_provider_secret;

const EXTENSION_ID_REGEX_HINT: &str = "expected \"@scope/name\", lowercase kebab-case";

fn validate_extension_id(id: &str) -> Result<(), String> {
    let mut parts = id.splitn(2, '/');
    let scope = parts
        .next()
        .ok_or_else(|| format!("invalid extension id: {id} ({EXTENSION_ID_REGEX_HINT})"))?;
    let name = parts
        .next()
        .ok_or_else(|| format!("invalid extension id: {id} ({EXTENSION_ID_REGEX_HINT})"))?;
    if !scope.starts_with('@') {
        return Err(format!(
            "invalid extension id: {id} ({EXTENSION_ID_REGEX_HINT})"
        ));
    }
    let scope_body = &scope[1..];
    if !is_kebab(scope_body) || !is_kebab(name) {
        return Err(format!(
            "invalid extension id: {id} ({EXTENSION_ID_REGEX_HINT})"
        ));
    }
    Ok(())
}

fn is_kebab(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `@scope/name` → `@scope__name` for filesystem safety.
fn dir_name_for(extension_id: &str) -> String {
    extension_id.replace('/', "__")
}

fn extensions_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(dir.join("extensions"))
}

fn extension_dir(app: &AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    Ok(extensions_root(app)?.join(dir_name_for(extension_id)))
}

fn extension_data_dir(app: &AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(dir.join("extension-data").join(dir_name_for(extension_id)))
}

#[tauri::command]
pub async fn read_extension_manifest_at(source_path: String) -> Result<String, String> {
    let path = Path::new(&source_path).join("manifest.json");
    if !path.exists() {
        return Err(format!(
            "No manifest.json found in \"{source_path}\". Select a folder that contains an extension's manifest.json at its root."
        ));
    }
    fs::read_to_string(&path).map_err(|e| format!("read manifest: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_extension_files(
    app: AppHandle,
    source_path: String,
    extension_id: String,
) -> Result<String, String> {
    install_extension_files_impl(&app, &source_path, &extension_id)
}

// Copy extension files to install dir; shared by the standalone command and commit_extension_install.
pub fn install_extension_files_impl(
    app: &AppHandle,
    source_path: &str,
    extension_id: &str,
) -> Result<String, String> {
    validate_extension_id(extension_id)?;

    let source = PathBuf::from(source_path);
    if !source.is_dir() {
        return Err(format!("source path is not a directory: {source_path}"));
    }
    let resolved_source =
        fs::canonicalize(&source).map_err(|e| format!("canonicalize source: {e}"))?;

    let dest = extension_dir(app, extension_id)?;
    if let Ok(resolved_dest) = fs::canonicalize(&dest)
        && resolved_dest == resolved_source
    {
        return Err(format!(
            "Cannot install an extension from its own install directory ({})",
            dest.display()
        ));
    }

    let extensions_root = extensions_root(app)?;
    fs::create_dir_all(&extensions_root).map_err(|e| format!("mkdir extensions root: {e}"))?;
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("rm existing install: {e}"))?;
    }

    let result = (|| -> Result<(), String> {
        copy_dir_filtered(&resolved_source, &dest)?;
        verify_dest_contained(&dest)?;
        Ok(())
    })();

    if let Err(e) = result {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }

    let assets = extension_data_dir(app, extension_id)?.join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("mkdir assets: {e}"))?;

    Ok(dest.to_string_lossy().to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCreate {
    id: String,
    organization_id: String,
    name: String,
    #[serde(rename = "type")]
    provider_type: String,
    base_url: Option<String>,
    auth_shape: serde_json::Value,
    secret: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionRowPlan {
    id: String,
    name: String,
    version: String,
    manifest: serde_json::Value,
    config: serde_json::Value,
    enabled: bool,
    provenance_type: String,
    provenance_config: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindingPlan {
    provider_key: String,
    provider_id: String,
    override_base_url: Option<String>,
    model_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    extension_id: String,
    source_path: String,
    copy_files: bool,
    existing_path: Option<String>,
    providers_to_create: Vec<ProviderCreate>,
    extension: ExtensionRowPlan,
    is_update: bool,
    bindings: Vec<BindingPlan>,
}

// Commit a fully-resolved extension install: file copy + SQL writes in one transaction.
#[tauri::command(rename_all = "camelCase")]
pub async fn commit_extension_install(app: AppHandle, plan: InstallPlan) -> Result<(), String> {
    // Re-derive signature authoritatively; invalid = tamper signal, absent = third-party, valid = Cloud-eligible.
    let signed = match crate::extension_signature::check_extension_signature(Path::new(
        &plan.source_path,
    )) {
        SignatureStatus::Valid => true,
        SignatureStatus::Absent => false,
        SignatureStatus::Invalid => {
            return Err(
                "extension carries a signature that does not verify; refusing to install \
                 (the files may have been modified after signing)"
                    .to_string(),
            );
        }
    };

    let dest_path = if plan.copy_files {
        install_extension_files_impl(&app, &plan.source_path, &plan.extension_id)?
    } else {
        plan.existing_path
            .clone()
            .ok_or_else(|| "configure mode requires existingPath".to_string())?
    };

    let mut conn = open_main_db_rw(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    for p in &plan.providers_to_create {
        let (secret, last4) = match p.secret.as_deref() {
            Some(s) if !s.is_empty() => (Some(encrypt_provider_secret(&app, s)?), Some(last4(s))),
            _ => (None, None),
        };
        let auth_shape = serde_json::to_string(&p.auth_shape)
            .map_err(|e| format!("auth_shape serialize: {e}"))?;
        sqlx::query(
            "INSERT INTO providers (id, organization_id, name, type, base_url, auth_shape, secret, secret_last4) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&p.id)
        .bind(&p.organization_id)
        .bind(&p.name)
        .bind(&p.provider_type)
        .bind(&p.base_url)
        .bind(&auth_shape)
        .bind(&secret)
        .bind(&last4)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("provider insert: {e}"))?;
    }

    sqlx::query("DELETE FROM extension_providers WHERE extension_id = ?1")
        .bind(&plan.extension_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("delete bindings: {e}"))?;

    let manifest = serde_json::to_string(&plan.extension.manifest)
        .map_err(|e| format!("manifest serialize: {e}"))?;
    let config = serde_json::to_string(&plan.extension.config)
        .map_err(|e| format!("config serialize: {e}"))?;
    let provenance_config = serde_json::to_string(&plan.extension.provenance_config)
        .map_err(|e| format!("provenance_config serialize: {e}"))?;

    if plan.is_update {
        // Rewrite provenance on update: GitHub bumps carry a new SHA; bundled→GitHub flip prevents bundled sync reverting it.
        sqlx::query(
            "UPDATE extensions SET name = ?1, version = ?2, path = ?3, manifest = ?4, config = ?5, \
             signed = ?6, provenance_type = ?7, provenance_config = ?8, \
             updated_at = CURRENT_TIMESTAMP WHERE id = ?9",
        )
        .bind(&plan.extension.name)
        .bind(&plan.extension.version)
        .bind(&dest_path)
        .bind(&manifest)
        .bind(&config)
        .bind(signed)
        .bind(&plan.extension.provenance_type)
        .bind(&provenance_config)
        .bind(&plan.extension.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("extension update: {e}"))?;
    } else {
        sqlx::query(
            "INSERT INTO extensions (id, name, version, path, enabled, manifest, config, provenance_type, provenance_config, signed) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&plan.extension.id)
        .bind(&plan.extension.name)
        .bind(&plan.extension.version)
        .bind(&dest_path)
        .bind(plan.extension.enabled)
        .bind(&manifest)
        .bind(&config)
        .bind(&plan.extension.provenance_type)
        .bind(&provenance_config)
        .bind(signed)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("extension insert: {e}"))?;
    }

    for b in &plan.bindings {
        upsert_extension_provider(
            &mut tx,
            &plan.extension_id,
            &b.provider_key,
            &b.provider_id,
            b.override_base_url.as_deref(),
            b.model_key.as_deref(),
        )
        .await?;
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    let _ = conn.close().await;
    Ok(())
}

// Last 4 chars of the plaintext secret, matching TS `secret.slice(-4)`.
fn last4(s: &str) -> String {
    let count = s.chars().count();
    s.chars().skip(count.saturating_sub(4)).collect()
}

// Delete the extension row (its provider bindings cascade) then remove its files.
#[tauri::command(rename_all = "camelCase")]
pub async fn uninstall_extension(app: AppHandle, extension_id: String) -> Result<(), String> {
    let mut conn = open_main_db_rw(&app).await?;
    sqlx::query("DELETE FROM extensions WHERE id = ?1")
        .bind(&extension_id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("delete extension: {e}"))?;
    let _ = conn.close().await;

    uninstall_extension_files_impl(&app, &extension_id)
}

fn uninstall_extension_files_impl(app: &AppHandle, extension_id: &str) -> Result<(), String> {
    validate_extension_id(extension_id)?;
    let dir = extension_dir(app, extension_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("rm install dir: {e}"))?;
    }
    let data = extension_data_dir(app, extension_id)?;
    if data.exists() {
        fs::remove_dir_all(&data).map_err(|e| format!("rm data dir: {e}"))?;
    }
    Ok(())
}

fn copy_dir_filtered(source: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("mkdir {}: {e}", dest.display()))?;
    let entries =
        fs::read_dir(source).map_err(|e| format!("read_dir {}: {e}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let name = entry.file_name();
        if name == "node_modules" || name == ".git" {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&name);

        // symlink_metadata inspects the link itself rather than its target.
        let lstat =
            fs::symlink_metadata(&from).map_err(|e| format!("lstat {}: {e}", from.display()))?;
        let ft = lstat.file_type();
        if ft.is_symlink() {
            return Err(format!(
                "extension source contains a symlink ({}); symlinks are not allowed",
                from.display()
            ));
        }
        if ft.is_dir() {
            copy_dir_filtered(&from, &to)?;
        } else if ft.is_file() {
            fs::copy(&from, &to).map_err(|e| format!("copy {}: {e}", from.display()))?;
        } else {
            return Err(format!(
                "unsupported file type at {} (only regular files and directories are allowed)",
                from.display()
            ));
        }
    }
    Ok(())
}

/// Post-copy TOCTOU check: verify no symlinks and every path stays under the dest root.
fn verify_dest_contained(dest: &Path) -> Result<(), String> {
    let canonical_root =
        fs::canonicalize(dest).map_err(|e| format!("canonicalize {}: {e}", dest.display()))?;
    verify_walk(&canonical_root, dest)
}

fn verify_walk(canonical_root: &Path, dir: &Path) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let path = entry.path();
        let lstat =
            fs::symlink_metadata(&path).map_err(|e| format!("lstat {}: {e}", path.display()))?;
        if lstat.file_type().is_symlink() {
            return Err(format!(
                "installed tree contains a symlink ({}); rejecting extension install",
                path.display()
            ));
        }
        let canonical =
            fs::canonicalize(&path).map_err(|e| format!("canonicalize {}: {e}", path.display()))?;
        if !canonical.starts_with(canonical_root) {
            return Err(format!(
                "path escapes extension dir: {} resolves to {}",
                path.display(),
                canonical.display()
            ));
        }
        if lstat.is_dir() {
            verify_walk(canonical_root, &path)?;
        }
    }
    Ok(())
}

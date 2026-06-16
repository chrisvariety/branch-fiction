use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, Executor};
use tauri::{AppHandle, Manager};

use crate::migrations::MAIN_MIGRATIONS;
use crate::pipeline_worker::PipelineWorkerState;

const BACKUP_META: &str = "backup-meta.json";
const MAIN_DB: &str = "branch-fiction.db";
/// Data-dir entries swapped wholesale on restore; book-imports is transient scratch.
const RESTORED_ENTRIES: &[&str] = &[
    MAIN_DB,
    "branch-fiction.db-wal",
    "branch-fiction.db-shm",
    "storage",
    "extension-data",
    "extension-data-pending",
    "book-imports",
];

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))
}

pub(crate) fn ensure_no_imports_running(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<PipelineWorkerState>();
    let running = state.children.lock().map(|m| m.len()).unwrap_or(0);
    if running > 0 {
        return Err("a book import is running — wait for it to finish or cancel it first".into());
    }
    Ok(())
}

async fn vacuum_into(src_db: &Path, dest: &Path) -> Result<(), String> {
    let mut conn = SqliteConnectOptions::from_str(&src_db.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(30))
        .connect()
        .await
        .map_err(|e| format!("open {}: {e}", src_db.display()))?;
    let sql = format!(
        "VACUUM INTO '{}'",
        dest.to_string_lossy().replace('\'', "''")
    );
    let result = sqlx::query(&sql)
        .execute(&mut conn)
        .await
        .map(|_| ())
        .map_err(|e| format!("vacuum {}: {e}", src_db.display()));
    let _ = conn.close().await;
    result
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_app_backup(app: AppHandle, dest_path: String) -> Result<(), String> {
    ensure_no_imports_running(&app)?;
    build_backup_zip(&app, Path::new(&dest_path)).await
}

/// Builds a full backup zip at dest; caller is responsible for the import-running check.
pub(crate) async fn build_backup_zip(app: &AppHandle, dest: &Path) -> Result<(), String> {
    let data = data_dir(app)?;
    let staging =
        std::env::temp_dir().join(format!("branch-fiction-backup-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("mkdir staging: {e}"))?;

    let result = build_backup(&data, &staging, dest).await;
    let _ = std::fs::remove_dir_all(&staging);
    result
}

async fn build_backup(data: &Path, staging: &Path, dest: &Path) -> Result<(), String> {
    let main_db = data.join(MAIN_DB);
    if !main_db.exists() {
        return Err("main database not found".into());
    }
    vacuum_into(&main_db, &staging.join(MAIN_DB)).await?;
    strip_provider_data(&staging.join(MAIN_DB)).await?;

    copy_tree(&data.join("storage"), &staging.join("storage"), &mut |_| {
        CopyAction::Copy
    })?;
    copy_tree(
        &data.join("extension-data-pending"),
        &staging.join("extension-data-pending"),
        &mut |_| CopyAction::Copy,
    )?;

    // Extension DBs are live (WAL); snapshot them instead of copying raw files.
    let mut db_snapshots: Vec<(PathBuf, PathBuf)> = Vec::new();
    copy_tree(
        &data.join("extension-data"),
        &staging.join("extension-data"),
        &mut |rel| {
            let name = rel.file_name().map(|n| n.to_string_lossy().into_owned());
            match name.as_deref() {
                Some("db.sqlite") => CopyAction::Snapshot,
                Some("db.sqlite-wal") | Some("db.sqlite-shm") => CopyAction::Skip,
                _ => CopyAction::Copy,
            }
        },
    )?;
    collect_db_snapshots(
        &data.join("extension-data"),
        &staging.join("extension-data"),
        &mut db_snapshots,
    )?;
    for (src, dest_db) in db_snapshots {
        vacuum_into(&src, &dest_db).await?;
    }

    let schema_version = MAIN_MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
    let meta = serde_json::json!({ "schema_version": schema_version });
    std::fs::write(staging.join(BACKUP_META), meta.to_string())
        .map_err(|e| format!("write {BACKUP_META}: {e}"))?;

    zip_dir(staging, dest)
}

/// Provider keys never travel; FK actions clean up dependents (cascades / SET NULL).
async fn strip_provider_data(db: &Path) -> Result<(), String> {
    let mut conn = SqliteConnectOptions::from_str(&db.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .connect()
        .await
        .map_err(|e| format!("open snapshot: {e}"))?;
    let statements = [
        "DELETE FROM extension_providers",
        "DELETE FROM providers",
        "UPDATE users SET external_id = NULL",
    ];
    for sql in statements {
        if let Err(e) = conn.execute(sql).await {
            let _ = conn.close().await;
            return Err(format!("strip providers ({sql}): {e}"));
        }
    }
    let _ = conn.close().await;
    Ok(())
}

enum CopyAction {
    Copy,
    Skip,
    /// Handled separately by an async VACUUM INTO pass.
    Snapshot,
}

/// Recursively copies src into dest, skipping symlinks; action decides per-file handling.
fn copy_tree(
    src: &Path,
    dest: &Path,
    action: &mut dyn FnMut(&Path) -> CopyAction,
) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(dest).map_err(|e| format!("mkdir {}: {e}", dest.display()))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("stat: {e}"))?;
        if meta.is_symlink() {
            continue;
        }
        let target = dest.join(entry.file_name());
        if meta.is_dir() {
            copy_tree(&path, &target, action)?;
        } else {
            match action(&path) {
                CopyAction::Copy => {
                    std::fs::copy(&path, &target)
                        .map_err(|e| format!("copy {}: {e}", path.display()))?;
                }
                CopyAction::Skip | CopyAction::Snapshot => {}
            }
        }
    }
    Ok(())
}

/// Pairs every extension db.sqlite with its staging destination for the vacuum pass.
fn collect_db_snapshots(
    src: &Path,
    dest: &Path,
    out: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let db = entry.path().join("db.sqlite");
        if db.is_file() {
            out.push((db, dest.join(entry.file_name()).join("db.sqlite")));
        }
    }
    Ok(())
}

fn zip_dir(root: &Path, dest: &Path) -> Result<(), String> {
    let file = File::create(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    add_dir_to_zip(&mut zip, root, root, options)?;
    zip.finish().map_err(|e| format!("finish zip: {e}"))?;
    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<File>,
    root: &Path,
    dir: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            add_dir_to_zip(zip, root, &path, options)?;
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|e| format!("strip prefix: {e}"))?
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        zip.start_file(&rel, options)
            .map_err(|e| format!("zip {rel}: {e}"))?;
        let mut f = File::open(&path).map_err(|e| format!("open {}: {e}", path.display()))?;
        std::io::copy(&mut f, zip).map_err(|e| format!("zip {rel}: {e}"))?;
    }
    Ok(())
}

/// Returns false under `tauri dev`, where restart is unreliable and must be done manually.
#[tauri::command(rename_all = "camelCase")]
pub async fn restore_app_backup(app: AppHandle, path: String) -> Result<bool, String> {
    ensure_no_imports_running(&app)?;
    stage_restore_from_zip(&app, Path::new(&path))?;
    if tauri::is_dev() {
        return Ok(false);
    }
    app.restart();
}

/// Validates and extracts a backup zip into restore-staging, applied on next launch.
pub(crate) fn stage_restore_from_zip(app: &AppHandle, path: &Path) -> Result<(), String> {
    let data = data_dir(app)?;

    let file = File::open(path).map_err(|e| format!("open backup: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|_| "not a Branch Fiction backup file".to_string())?;
    validate_backup(&mut archive)?;

    let staging_tmp = data.join("restore-staging-tmp");
    let staging = data.join("restore-staging");
    let _ = std::fs::remove_dir_all(&staging_tmp);
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging_tmp).map_err(|e| format!("mkdir staging: {e}"))?;

    if let Err(e) = extract_backup(&mut archive, &staging_tmp) {
        let _ = std::fs::remove_dir_all(&staging_tmp);
        return Err(e);
    }
    std::fs::rename(&staging_tmp, &staging).map_err(|e| format!("commit staging: {e}"))?;
    Ok(())
}

fn validate_backup(archive: &mut zip::ZipArchive<File>) -> Result<(), String> {
    archive
        .by_name(MAIN_DB)
        .map(|_| ())
        .map_err(|_| "not a Branch Fiction backup file".to_string())?;

    let mut meta_json = String::new();
    archive
        .by_name(BACKUP_META)
        .map_err(|_| "not a Branch Fiction backup file".to_string())?
        .read_to_string(&mut meta_json)
        .map_err(|e| format!("read {BACKUP_META}: {e}"))?;
    let meta: serde_json::Value =
        serde_json::from_str(&meta_json).map_err(|e| format!("parse {BACKUP_META}: {e}"))?;
    let schema_version = meta
        .get("schema_version")
        .and_then(|v| v.as_i64())
        .ok_or("backup missing schema_version")?;
    let current_version = MAIN_MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
    if schema_version > current_version {
        return Err(
            "this backup was made by a newer version of the app — update the app to restore it"
                .into(),
        );
    }
    Ok(())
}

fn extract_backup(archive: &mut zip::ZipArchive<File>, dest: &Path) -> Result<(), String> {
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("read zip entry {i}: {e}"))?;
        let raw_name = entry.name().to_string();
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("backup contains unsafe entry name: {raw_name}"));
        };
        if entry.is_symlink() {
            return Err(format!("backup contains a symlink ({raw_name})"));
        }
        if entry.is_dir() {
            continue;
        }
        let target = dest.join(&rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut out =
            File::create(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("extract {raw_name}: {e}"))?;
        out.flush().map_err(|e| format!("flush {raw_name}: {e}"))?;
    }
    Ok(())
}

/// Runs before anything opens the DB: swaps a staged restore into place, parking the old state.
pub fn apply_pending_restore(app: &AppHandle) {
    let Ok(data) = data_dir(app) else {
        return;
    };
    let staging = data.join("restore-staging");
    if !staging.join(MAIN_DB).is_file() {
        return;
    }

    let parked = data.join("pre-restore");
    let _ = std::fs::remove_dir_all(&parked);
    if let Err(e) = std::fs::create_dir_all(&parked) {
        eprintln!("restore: mkdir pre-restore: {e}");
        return;
    }

    for name in RESTORED_ENTRIES {
        let current = data.join(name);
        if current.exists()
            && let Err(e) = std::fs::rename(&current, parked.join(name))
        {
            eprintln!("restore: park {name}: {e}");
            return;
        }
    }

    match std::fs::read_dir(&staging) {
        Ok(entries) => {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.file_name() == BACKUP_META {
                    continue;
                }
                let target = data.join(entry.file_name());
                if let Err(e) = std::fs::rename(entry.path(), &target) {
                    eprintln!("restore: move {}: {e}", entry.file_name().to_string_lossy());
                }
            }
        }
        Err(e) => {
            eprintln!("restore: read staging: {e}");
            return;
        }
    }
    let _ = std::fs::remove_dir_all(&staging);
    eprintln!("restore: backup applied; previous state parked in pre-restore/");
}

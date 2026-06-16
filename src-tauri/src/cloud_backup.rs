use std::path::Path;

use futures_util::StreamExt;
use keyring_core::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use sqlx::Connection;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::app_backup::{build_backup_zip, ensure_no_imports_running, stage_restore_from_zip};
use crate::backup_crypto;
use crate::cloud_state::CloudState;
use crate::db_path::open_main_db_ro;
use crate::migrations::MAIN_MIGRATIONS;
use crate::provider_resolve::cloud_external_id;

const CLOUD_BACKUPS_URL: &str = "https://cloud.branchfiction.com/backups";
const PHRASE_ACCOUNT: &str = "backup-recovery-phrase";
const UPLOAD_CHUNK: usize = 256 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryKey {
    phrase: String,
    fingerprint: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    stage: &'static str,
    transferred: u64,
    total: u64,
}

#[derive(Serialize, Deserialize)]
pub struct CloudBackupEntry {
    pub id: String,
    #[serde(rename(deserialize = "size_bytes", serialize = "sizeBytes"))]
    pub size_bytes: Option<i64>,
    #[serde(rename(deserialize = "schema_version", serialize = "schemaVersion"))]
    pub schema_version: i64,
    #[serde(rename(deserialize = "key_fingerprint", serialize = "keyFingerprint"))]
    pub key_fingerprint: String,
    #[serde(rename(deserialize = "created_at", serialize = "createdAt"))]
    pub created_at: String,
}

fn phrase_entry(app: &AppHandle) -> Result<Entry, String> {
    Entry::new(&app.config().identifier, PHRASE_ACCOUNT).map_err(|e| e.to_string())
}

fn stored_phrase(app: &AppHandle) -> Result<Option<String>, String> {
    match phrase_entry(app)?.get_secret() {
        Ok(bytes) => {
            Ok(Some(String::from_utf8(bytes).map_err(|_| {
                "stored recovery key is corrupted".to_string()
            })?))
        }
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn require_phrase(app: &AppHandle) -> Result<String, String> {
    stored_phrase(app)?.ok_or_else(|| "no recovery key set — create or enter one first".to_string())
}

fn recovery_key(phrase: String) -> Result<RecoveryKey, String> {
    let fingerprint = backup_crypto::key_fingerprint(&phrase)?;
    Ok(RecoveryKey {
        phrase,
        fingerprint,
    })
}

#[tauri::command]
pub fn get_backup_recovery_key(app: AppHandle) -> Result<Option<RecoveryKey>, String> {
    stored_phrase(&app)?.map(recovery_key).transpose()
}

#[tauri::command]
pub fn create_backup_recovery_key(app: AppHandle) -> Result<RecoveryKey, String> {
    if stored_phrase(&app)?.is_some() {
        return Err("a recovery key already exists on this device".into());
    }
    let phrase = backup_crypto::generate_recovery_phrase()?;
    phrase_entry(&app)?
        .set_secret(phrase.as_bytes())
        .map_err(|e| e.to_string())?;
    recovery_key(phrase)
}

#[tauri::command]
pub fn set_backup_recovery_key(app: AppHandle, phrase: String) -> Result<RecoveryKey, String> {
    let phrase = backup_crypto::normalize_recovery_phrase(&phrase)?;
    phrase_entry(&app)?
        .set_secret(phrase.as_bytes())
        .map_err(|e| e.to_string())?;
    recovery_key(phrase)
}

async fn cloud_jwt(app: &AppHandle) -> Result<String, String> {
    let mut conn = open_main_db_ro(app).await?;
    let external_id = cloud_external_id(&mut conn).await;
    let _ = conn.close().await;
    app.state::<CloudState>()
        .mint_or_get_jwt(&external_id?)
        .await
}

fn check_backup_id(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid backup id".into());
    }
    Ok(())
}

async fn cloud_json(resp: reqwest::Response, what: &str) -> Result<serde_json::Value, String> {
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    let ok = status.is_success() && body.get("success").and_then(|v| v.as_bool()) == Some(true);
    if !ok {
        let msg = body
            .pointer("/errors/0/message")
            .and_then(|v| v.as_str())
            .unwrap_or("request failed");
        return Err(format!("{what}: {msg} ({status})"));
    }
    Ok(body)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_cloud_backup(
    app: AppHandle,
    on_progress: Channel<BackupProgress>,
) -> Result<(), String> {
    ensure_no_imports_running(&app)?;
    let phrase = require_phrase(&app)?;
    let jwt = cloud_jwt(&app).await?;

    let tmp = std::env::temp_dir().join(format!("bf-cloud-backup-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("mkdir tmp: {e}"))?;

    let result = create_cloud_backup_inner(&app, &phrase, &jwt, &tmp, &on_progress).await;
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

async fn create_cloud_backup_inner(
    app: &AppHandle,
    phrase: &str,
    jwt: &str,
    tmp: &Path,
    on_progress: &Channel<BackupProgress>,
) -> Result<(), String> {
    let send = |stage, transferred, total| {
        let _ = on_progress.send(BackupProgress {
            stage,
            transferred,
            total,
        });
    };

    send("packing", 0, 0);
    let zip = tmp.join("backup.bfbackup");
    build_backup_zip(app, &zip).await?;

    send("encrypting", 0, 0);
    let enc = tmp.join("backup.bfbackup.enc");
    {
        let (zip, enc, phrase) = (zip.clone(), enc.clone(), phrase.to_string());
        tauri::async_runtime::spawn_blocking(move || {
            backup_crypto::encrypt_file(&zip, &enc, &phrase)
        })
        .await
        .map_err(|e| format!("encrypt task: {e}"))??;
    }
    let _ = std::fs::remove_file(&zip);

    let size = std::fs::metadata(&enc)
        .map_err(|e| format!("stat upload: {e}"))?
        .len();
    let fingerprint = backup_crypto::key_fingerprint(phrase)?;
    let schema_version = MAIN_MIGRATIONS.last().map(|m| m.version).unwrap_or(0);

    let client = reqwest::Client::new();
    let resp = client
        .post(CLOUD_BACKUPS_URL)
        .bearer_auth(jwt)
        .json(&serde_json::json!({
            "sizeBytes": size,
            "schemaVersion": schema_version,
            "keyFingerprint": fingerprint,
        }))
        .send()
        .await
        .map_err(|e| format!("create backup: {e}"))?;
    let body = cloud_json(resp, "create backup").await?;
    let id = body
        .pointer("/result/id")
        .and_then(|v| v.as_str())
        .ok_or("create backup: missing id")?
        .to_string();
    let upload_url = body
        .pointer("/result/uploadUrl")
        .and_then(|v| v.as_str())
        .ok_or("create backup: missing uploadUrl")?
        .to_string();

    upload_file(&client, &upload_url, &enc, size, on_progress).await?;

    let resp = client
        .post(format!("{CLOUD_BACKUPS_URL}/{id}/complete"))
        .bearer_auth(jwt)
        .send()
        .await
        .map_err(|e| format!("finish backup: {e}"))?;
    cloud_json(resp, "finish backup").await?;
    Ok(())
}

async fn upload_file(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    total: u64,
    on_progress: &Channel<BackupProgress>,
) -> Result<(), String> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("open upload: {e}"))?;
    let progress = on_progress.clone();
    let stream = futures_util::stream::try_unfold((file, 0u64), move |(mut f, sent)| {
        let progress = progress.clone();
        async move {
            let mut buf = vec![0u8; UPLOAD_CHUNK];
            let n = f.read(&mut buf).await?;
            if n == 0 {
                return Ok::<_, std::io::Error>(None);
            }
            buf.truncate(n);
            let sent = sent + n as u64;
            let _ = progress.send(BackupProgress {
                stage: "uploading",
                transferred: sent,
                total,
            });
            Ok(Some((buf, (f, sent))))
        }
    });
    let resp = client
        .put(url)
        .header(reqwest::header::CONTENT_LENGTH, total)
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await
        .map_err(|e| format!("upload: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("upload failed: {}", resp.status()));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_cloud_backups(app: AppHandle) -> Result<Vec<CloudBackupEntry>, String> {
    let jwt = cloud_jwt(&app).await?;
    let resp = reqwest::Client::new()
        .get(CLOUD_BACKUPS_URL)
        .bearer_auth(&jwt)
        .send()
        .await
        .map_err(|e| format!("list backups: {e}"))?;
    let body = cloud_json(resp, "list backups").await?;
    let backups = body
        .pointer("/result/backups")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    serde_json::from_value(backups).map_err(|e| format!("list backups: {e}"))
}

#[tauri::command]
pub async fn delete_cloud_backup(app: AppHandle, id: String) -> Result<(), String> {
    check_backup_id(&id)?;
    let jwt = cloud_jwt(&app).await?;
    let resp = reqwest::Client::new()
        .delete(format!("{CLOUD_BACKUPS_URL}/{id}"))
        .bearer_auth(&jwt)
        .send()
        .await
        .map_err(|e| format!("delete backup: {e}"))?;
    cloud_json(resp, "delete backup").await?;
    Ok(())
}

/// Returns false under `tauri dev`, matching restore_app_backup.
#[tauri::command(rename_all = "camelCase")]
pub async fn restore_cloud_backup(
    app: AppHandle,
    id: String,
    on_progress: Channel<BackupProgress>,
) -> Result<bool, String> {
    ensure_no_imports_running(&app)?;
    check_backup_id(&id)?;
    let phrase = require_phrase(&app)?;
    let jwt = cloud_jwt(&app).await?;

    let tmp = std::env::temp_dir().join(format!("bf-cloud-restore-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("mkdir tmp: {e}"))?;

    let result = restore_cloud_backup_inner(&app, &id, &phrase, &jwt, &tmp, &on_progress).await;
    let _ = std::fs::remove_dir_all(&tmp);
    result?;

    if tauri::is_dev() {
        return Ok(false);
    }
    app.restart();
}

async fn restore_cloud_backup_inner(
    app: &AppHandle,
    id: &str,
    phrase: &str,
    jwt: &str,
    tmp: &Path,
    on_progress: &Channel<BackupProgress>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{CLOUD_BACKUPS_URL}/{id}/download"))
        .bearer_auth(jwt)
        .send()
        .await
        .map_err(|e| format!("download backup: {e}"))?;
    let body = cloud_json(resp, "download backup").await?;
    let url = body
        .pointer("/result/downloadUrl")
        .and_then(|v| v.as_str())
        .ok_or("download backup: missing downloadUrl")?
        .to_string();

    let enc = tmp.join("backup.bfbackup.enc");
    download_file(&client, &url, &enc, on_progress).await?;

    let _ = on_progress.send(BackupProgress {
        stage: "decrypting",
        transferred: 0,
        total: 0,
    });
    let zip = tmp.join("backup.bfbackup");
    {
        let (enc, zip, phrase) = (enc.clone(), zip.clone(), phrase.to_string());
        tauri::async_runtime::spawn_blocking(move || {
            backup_crypto::decrypt_file(&enc, &zip, &phrase)
        })
        .await
        .map_err(|e| format!("decrypt task: {e}"))??;
    }

    stage_restore_from_zip(app, &zip)
}

async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    on_progress: &Channel<BackupProgress>,
) -> Result<(), String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut out = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("create download: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut received = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download: {e}"))?;
        out.write_all(&chunk)
            .await
            .map_err(|e| format!("write download: {e}"))?;
        received += chunk.len() as u64;
        let _ = on_progress.send(BackupProgress {
            stage: "downloading",
            transferred: received,
            total,
        });
    }
    out.flush()
        .await
        .map_err(|e| format!("flush download: {e}"))
}

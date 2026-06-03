use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::db_path::open_main_db_rw;
use crate::extension_db::{extension_dev_data_dir, prepare_extension_dev_db};

const PAIR_CODE_TTL: Duration = Duration::from_secs(5 * 60);
const TOKEN_PREFIX: &str = "pdc_";

#[derive(Clone, Default)]
pub struct ExtensionDevState {
    pending: Arc<Mutex<HashMap<String, Instant>>>,
}

impl ExtensionDevState {
    fn issue_code(&self) -> String {
        let mut pending = self.pending.lock().expect("extension_dev pending poisoned");
        sweep_expired(&mut pending);
        let code = loop {
            let candidate = Uuid::new_v4().simple().to_string();
            if !pending.contains_key(&candidate) {
                break candidate;
            }
        };
        pending.insert(code.clone(), Instant::now() + PAIR_CODE_TTL);
        code
    }

    fn consume_code(&self, code: &str) -> bool {
        let mut pending = self.pending.lock().expect("extension_dev pending poisoned");
        sweep_expired(&mut pending);
        match pending.remove(code) {
            Some(expires_at) => expires_at > Instant::now(),
            None => false,
        }
    }
}

fn sweep_expired(map: &mut HashMap<String, Instant>) {
    let now = Instant::now();
    map.retain(|_, expires_at| *expires_at > now);
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_iso() -> String {
    // SQLite-friendly ISO8601 in UTC; matches `datetime('now')` shape.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    format_unix_secs(secs)
}

fn format_unix_secs(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400) as u32;
    let (y, m, d) = civil_from_days(days);
    let h = secs_of_day / 3600;
    let mi = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;
    format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}")
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

#[derive(Serialize)]
pub struct PairCode {
    code: String,
    #[serde(rename = "expiresAt")]
    expires_at: i64,
}

#[derive(Serialize)]
pub struct DevClient {
    #[serde(rename = "extensionId")]
    extension_id: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "lastUsedAt")]
    last_used_at: Option<String>,
    #[serde(rename = "revokedAt")]
    revoked_at: Option<String>,
}

#[tauri::command]
pub fn extension_dev_code_create(state: tauri::State<'_, ExtensionDevState>) -> PairCode {
    let code = state.issue_code();
    PairCode {
        code,
        expires_at: now_ms() + PAIR_CODE_TTL.as_millis() as i64,
    }
}

#[tauri::command]
pub async fn extension_dev_clients_list(app: AppHandle) -> Result<Vec<DevClient>, String> {
    let mut conn = open_main_db_rw(&app).await?;
    let rows = sqlx::query(
        "SELECT extension_id, created_at, last_used_at, revoked_at \
         FROM extension_dev_clients ORDER BY created_at DESC",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|e| format!("extension_dev_clients query: {e}"))?;
    let _ = conn.close().await;
    Ok(rows
        .into_iter()
        .map(|r| DevClient {
            extension_id: r.get(0),
            created_at: r.get(1),
            last_used_at: r.get(2),
            revoked_at: r.get(3),
        })
        .collect())
}

#[tauri::command]
pub async fn extension_dev_client_revoke(
    app: AppHandle,
    extension_id: String,
) -> Result<(), String> {
    let mut conn = open_main_db_rw(&app).await?;
    sqlx::query("UPDATE extension_dev_clients SET revoked_at = ?1 WHERE extension_id = ?2")
        .bind(now_iso())
        .bind(&extension_id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("revoke: {e}"))?;
    let _ = conn.close().await;
    Ok(())
}

#[derive(Deserialize)]
pub struct PairRequest {
    #[serde(rename = "extensionId")]
    extension_id: String,
    code: String,
}

#[derive(Serialize)]
pub struct PairResponse {
    token: String,
}

pub async fn pair_handler(
    State(app): State<AppHandle>,
    Json(req): Json<PairRequest>,
) -> Result<Json<PairResponse>, (StatusCode, String)> {
    let dev_state = app.state::<ExtensionDevState>();
    if !dev_state.consume_code(&req.code) {
        return Err((StatusCode::UNAUTHORIZED, "invalid or expired code".into()));
    }
    let token = format!("{TOKEN_PREFIX}{}", Uuid::new_v4().simple());
    let mut conn = open_main_db_rw(&app).await.map_err(internal)?;
    sqlx::query(
        "INSERT INTO extension_dev_clients (extension_id, token, created_at) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(extension_id) DO UPDATE SET \
           token = excluded.token, \
           created_at = excluded.created_at, \
           last_used_at = NULL, \
           revoked_at = NULL",
    )
    .bind(&req.extension_id)
    .bind(&token)
    .bind(now_iso())
    .execute(&mut conn)
    .await
    .map_err(|e| internal(format!("insert extension_dev_clients: {e}")))?;
    let _ = conn.close().await;
    let _ = app.emit("query:invalidate", &req.extension_id);
    Ok(Json(PairResponse { token }))
}

#[derive(Deserialize)]
pub struct PrepareRequest {
    #[serde(rename = "extensionId")]
    extension_id: String,
}

#[derive(Serialize)]
pub struct PrepareResponse {
    #[serde(rename = "dataDir")]
    data_dir: String,
    #[serde(rename = "dbPath")]
    db_path: String,
    #[serde(rename = "assetsDir")]
    assets_dir: String,
    #[serde(rename = "denoBin", skip_serializing_if = "Option::is_none")]
    deno_bin: Option<String>,
}

pub async fn prepare_db_handler(
    State(app): State<AppHandle>,
    headers: HeaderMap,
    Json(req): Json<PrepareRequest>,
) -> Result<Json<PrepareResponse>, (StatusCode, String)> {
    let token_extension_id = authenticate(&app, &headers).await?;
    if token_extension_id != req.extension_id {
        return Err((
            StatusCode::FORBIDDEN,
            format!(
                "token bound to {token_extension_id}, not {}",
                req.extension_id
            ),
        ));
    }
    let db_path = prepare_extension_dev_db(&app, &req.extension_id)
        .await
        .map_err(internal)?;
    let data_dir = extension_dev_data_dir(&app, &req.extension_id).map_err(internal)?;
    let assets_dir = data_dir.join("assets");
    Ok(Json(PrepareResponse {
        data_dir: data_dir.to_string_lossy().into_owned(),
        db_path: db_path.to_string_lossy().into_owned(),
        assets_dir: assets_dir.to_string_lossy().into_owned(),
        deno_bin: bundled_deno_path().map(|p| p.to_string_lossy().into_owned()),
    }))
}

fn bundled_deno_path() -> Option<std::path::PathBuf> {
    let current = std::env::current_exe().ok()?;
    let parent = current.parent()?;
    let name = if cfg!(windows) { "deno.exe" } else { "deno" };
    let candidate = parent.join(name);
    candidate.exists().then_some(candidate)
}

async fn authenticate(
    app: &AppHandle,
    headers: &HeaderMap,
) -> Result<String, (StatusCode, String)> {
    let raw = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::UNAUTHORIZED,
            "missing Authorization header".into(),
        ))?;
    let token = raw
        .strip_prefix("Bearer ")
        .ok_or((StatusCode::UNAUTHORIZED, "expected Bearer token".into()))?;
    let mut conn = open_main_db_rw(app).await.map_err(internal)?;
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT extension_id, revoked_at FROM extension_dev_clients WHERE token = ?1",
    )
    .bind(token)
    .fetch_optional(&mut conn)
    .await
    .map_err(|e| internal(format!("auth lookup: {e}")))?;
    let (extension_id, revoked_at) =
        row.ok_or((StatusCode::UNAUTHORIZED, "unknown token".into()))?;
    if revoked_at.is_some() {
        let _ = conn.close().await;
        return Err((StatusCode::UNAUTHORIZED, "token revoked".into()));
    }
    let _ = sqlx::query("UPDATE extension_dev_clients SET last_used_at = ?1 WHERE token = ?2")
        .bind(now_iso())
        .bind(token)
        .execute(&mut conn)
        .await;
    let _ = conn.close().await;
    Ok(extension_id)
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

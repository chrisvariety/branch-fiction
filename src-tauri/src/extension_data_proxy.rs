use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;

use axum::{
    Json,
    extract::{Path as AxumPath, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Column, ConnectOptions, Connection, Row, SqliteConnection, TypeInfo, ValueRef};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::fs;

use crate::extension_auth::verify_path_token;
use crate::extension_db::extension_assets_dir;

fn extension_db_path(app: &AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let safe_id = extension_id.replace('/', "__");
    Ok(dir.join("extension-data").join(safe_id).join("db.sqlite"))
}

async fn open_extension_db(
    app: &AppHandle,
    extension_id: &str,
) -> Result<SqliteConnection, String> {
    let path = extension_db_path(app, extension_id)?;
    let path_str = path.to_string_lossy().to_string();
    let mut conn = SqliteConnectOptions::from_str(&path_str)
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .connect()
        .await
        .map_err(|e| format!("open extension db: {e}"))?;
    disable_attach(&mut conn).await?;
    Ok(conn)
}

// Set SQLITE_LIMIT_ATTACHED = 0 to block ATTACH from reaching arbitrary on-disk files.
async fn disable_attach(conn: &mut SqliteConnection) -> Result<(), String> {
    let mut handle = conn
        .lock_handle()
        .await
        .map_err(|e| format!("lock sqlite handle: {e}"))?;
    let db = handle.as_raw_handle().as_ptr();
    unsafe {
        libsqlite3_sys::sqlite3_limit(db, libsqlite3_sys::SQLITE_LIMIT_ATTACHED, 0);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct DbQueryBody {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

#[derive(Serialize)]
pub struct DbQueryResponse {
    pub rows: Vec<HashMap<String, Value>>,
    pub changes: u64,
}

pub async fn db_query_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(body): Json<DbQueryBody>,
) -> Result<Json<DbQueryResponse>, (StatusCode, String)> {
    let claims = verify_path_token(&app, &token)?;

    let mut conn = open_extension_db(&app, &claims.sub)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let trimmed = body.sql.trim_start().to_ascii_lowercase();
    let is_query = trimmed.starts_with("select")
        || trimmed.starts_with("with")
        || trimmed.starts_with("pragma")
        || trimmed.starts_with("explain");

    if is_query {
        let mut q = sqlx::query(&body.sql);
        for p in &body.params {
            q = bind_value(q, p);
        }
        let rows = q
            .fetch_all(&mut conn)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("query: {e}")))?;
        let mapped = rows.iter().map(row_to_object).collect::<Vec<_>>();
        let _ = conn.close().await;
        Ok(Json(DbQueryResponse {
            rows: mapped,
            changes: 0,
        }))
    } else {
        let mut q = sqlx::query(&body.sql);
        for p in &body.params {
            q = bind_value(q, p);
        }
        let result = q
            .execute(&mut conn)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("execute: {e}")))?;
        let _ = conn.close().await;
        Ok(Json(DbQueryResponse {
            rows: Vec::new(),
            changes: result.rows_affected(),
        }))
    }
}

fn bind_value<'a>(
    q: sqlx::query::Query<'a, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'a>>,
    v: &'a Value,
) -> sqlx::query::Query<'a, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'a>> {
    match v {
        Value::Null => q.bind(Option::<String>::None),
        Value::Bool(b) => q.bind(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else if let Some(f) = n.as_f64() {
                q.bind(f)
            } else {
                q.bind(n.to_string())
            }
        }
        Value::String(s) => q.bind(s.as_str()),
        // Arrays/objects bound as JSON strings.
        Value::Array(_) | Value::Object(_) => q.bind(v.to_string()),
    }
}

fn row_to_object(row: &sqlx::sqlite::SqliteRow) -> HashMap<String, Value> {
    let mut out = HashMap::with_capacity(row.columns().len());
    for (i, col) in row.columns().iter().enumerate() {
        let name = col.name().to_string();
        let value = sqlite_column_to_json(row, i);
        out.insert(name, value);
    }
    out
}

fn sqlite_column_to_json(row: &sqlx::sqlite::SqliteRow, i: usize) -> Value {
    let raw = row.try_get_raw(i);
    let Ok(raw) = raw else {
        return Value::Null;
    };
    if raw.is_null() {
        return Value::Null;
    }
    let type_name = raw.type_info().name().to_string();
    match type_name.as_str() {
        "INTEGER" | "BIGINT" | "INT" | "INT8" => row
            .try_get::<i64, _>(i)
            .map(Value::from)
            .unwrap_or(Value::Null),
        "REAL" | "FLOAT" | "DOUBLE" => row
            .try_get::<f64, _>(i)
            .map(Value::from)
            .unwrap_or(Value::Null),
        "BOOLEAN" => row
            .try_get::<bool, _>(i)
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        "BLOB" => row
            .try_get::<Vec<u8>, _>(i)
            .map(|b| Value::String(B64.encode(b)))
            .unwrap_or(Value::Null),
        _ => row
            .try_get::<String, _>(i)
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

#[derive(Deserialize)]
pub struct FsReadBody {
    #[serde(rename = "relPath")]
    pub rel_path: String,
}

#[derive(Serialize)]
pub struct FsReadResponse {
    #[serde(rename = "bytesBase64")]
    pub bytes_base64: String,
}

pub async fn fs_read_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(body): Json<FsReadBody>,
) -> Result<Json<FsReadResponse>, (StatusCode, String)> {
    let claims = verify_path_token(&app, &token)?;
    let path = resolve_in_assets(&app, &claims.sub, &body.rel_path)?;
    let bytes = fs::read(&path)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, format!("read: {e}")))?;
    Ok(Json(FsReadResponse {
        bytes_base64: B64.encode(bytes),
    }))
}

#[derive(Deserialize)]
pub struct FsWriteBody {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    #[serde(rename = "bytesBase64")]
    pub bytes_base64: String,
}

pub async fn fs_write_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(body): Json<FsWriteBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let claims = verify_path_token(&app, &token)?;
    let path = resolve_in_assets(&app, &claims.sub, &body.rel_path)?;
    let bytes = B64
        .decode(body.bytes_base64.as_bytes())
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("base64: {e}")))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("mkdir: {e}")))?;
    }
    fs::write(&path, bytes)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("write: {e}")))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct OpenExternalBody {
    pub url: String,
}

// Opens a URL in the user's default browser; sandboxed extension iframes can't do this.
pub async fn open_external_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(body): Json<OpenExternalBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    verify_path_token(&app, &token)?;
    if !body.url.starts_with("http://") && !body.url.starts_with("https://") {
        return Err((StatusCode::BAD_REQUEST, "only http(s) URLs are allowed".into()));
    }
    app.opener()
        .open_url(body.url, None::<&str>)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("open: {e}")))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct SaveFileBody {
    pub filename: String,
    #[serde(rename = "bytesBase64")]
    pub bytes_base64: String,
}

// Prompts a native Save dialog and writes the bytes; sandboxed iframes can't download.
pub async fn save_file_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(body): Json<SaveFileBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    verify_path_token(&app, &token)?;
    let bytes = B64
        .decode(body.bytes_base64.as_bytes())
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("base64: {e}")))?;

    let dialog_app = app.clone();
    let filename = body.filename;
    let chosen = tokio::task::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_file_name(filename)
            .blocking_save_file()
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("dialog: {e}")))?;

    let Some(file_path) = chosen else {
        return Ok(Json(serde_json::json!({ "saved": false })));
    };
    let path = file_path
        .into_path()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("path: {e}")))?;
    fs::write(&path, bytes)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("write: {e}")))?;
    Ok(Json(serde_json::json!({ "saved": true })))
}

#[derive(Deserialize, Default)]
pub struct FsListBody {
    #[serde(rename = "relPath")]
    #[serde(default)]
    pub rel_path: Option<String>,
}

#[derive(Serialize)]
pub struct FsListEntry {
    pub name: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}

pub async fn fs_list_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(body): Json<FsListBody>,
) -> Result<Json<Vec<FsListEntry>>, (StatusCode, String)> {
    let claims = verify_path_token(&app, &token)?;
    let rel = body.rel_path.unwrap_or_default();
    let path = resolve_in_assets(&app, &claims.sub, &rel)?;

    let mut out = Vec::new();
    let mut dir = match fs::read_dir(&path).await {
        Ok(d) => d,
        Err(_) => return Ok(Json(out)),
    };
    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("readdir: {e}")))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_directory = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
        out.push(FsListEntry { name, is_directory });
    }
    Ok(Json(out))
}

#[derive(Serialize)]
pub struct ContextResponse {
    #[serde(rename = "extensionId")]
    pub extension_id: String,
    #[serde(rename = "bookId")]
    pub book_id: Option<String>,
    pub providers: Map<String, Value>,
    pub config: Value,
}

pub async fn context_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Json<ContextResponse>, (StatusCode, String)> {
    let claims = verify_path_token(&app, &token)?;
    // Prefer X-Forwarded-Host (Vite proxy) so phone clients get LAN-IP proxyBaseURLs.
    let host = headers
        .get("x-forwarded-host")
        .and_then(|v| v.to_str().ok())
        .or_else(|| {
            headers
                .get(axum::http::header::HOST)
                .and_then(|v| v.to_str().ok())
        })
        .unwrap_or("127.0.0.1");
    let providers = inject_proxy_base_urls(claims.providers, host, &token);
    Ok(Json(ContextResponse {
        extension_id: claims.sub,
        book_id: claims.book_id,
        providers,
        config: claims.config,
    }))
}

/// For each provider entry, set `proxyBaseURL` to the absolute URL the
/// consumer should hit to forward through to the upstream provider.
pub fn inject_proxy_base_urls(
    providers: Map<String, Value>,
    host: &str,
    token: &str,
) -> Map<String, Value> {
    let mut out = Map::with_capacity(providers.len());
    for (key, value) in providers {
        let mut entry = value;
        if let Some(obj) = entry.as_object_mut() {
            let encoded_key = urlencoding_simple(&key);
            let proxy_url = format!("http://{host}/extension-providers/{token}/{encoded_key}");
            obj.insert("proxyBaseURL".to_string(), Value::String(proxy_url));
        }
        out.insert(key, entry);
    }
    out
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// Public, path-confined GET for extension-written assets,
/// e.g. `<img src="/extension-data/<id>/assets/...">`
/// token-less because the contents under assets dir are freely read by the extension.
pub async fn public_asset_handler(
    State(app): State<AppHandle>,
    AxumPath((extension_id, rest)): AxumPath<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Reject non-`@scope/name` ids to avoid accidentally matching a JWT.
    if !extension_id.starts_with('@') || !extension_id.contains('/') {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }
    let path = resolve_in_assets(&app, &extension_id, &rest)?;
    let bytes = fs::read(&path)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, format!("read: {e}")))?;
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(guess_asset_content_type(&path)) {
        headers.insert(header::CONTENT_TYPE, v);
    }
    Ok((headers, bytes))
}

fn guess_asset_content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "json" => "application/json; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn resolve_in_assets(
    app: &AppHandle,
    extension_id: &str,
    rel: &str,
) -> Result<PathBuf, (StatusCode, String)> {
    let root = extension_assets_dir(app, extension_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    if has_traversal(rel) {
        return Err((StatusCode::BAD_REQUEST, "invalid path".to_string()));
    }
    let joined = root.join(rel);
    let canonical = canonicalize_or_self(&joined);
    let canonical_root = canonicalize_or_self(&root);
    if !canonical.starts_with(&canonical_root) {
        return Err((
            StatusCode::BAD_REQUEST,
            "path escapes assets dir".to_string(),
        ));
    }
    Ok(joined)
}

fn canonicalize_or_self(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn has_traversal(s: &str) -> bool {
    PathBuf::from(s).components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // No `tokio::test` macro feature is enabled, so drive a runtime by hand.
    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build runtime")
            .block_on(f)
    }

    async fn open_mem() -> SqliteConnection {
        SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .connect()
            .await
            .unwrap()
    }

    #[test]
    fn disable_attach_blocks_attach() {
        block_on(async {
            let mut conn = open_mem().await;
            disable_attach(&mut conn).await.unwrap();
            let err = sqlx::query("ATTACH DATABASE ':memory:' AS other")
                .execute(&mut conn)
                .await
                .expect_err("ATTACH must be rejected once disabled");
            assert!(
                err.to_string().to_ascii_lowercase().contains("attach"),
                "unexpected error: {err}"
            );
        });
    }

    #[test]
    fn ordinary_queries_still_work_after_disable() {
        block_on(async {
            let mut conn = open_mem().await;
            disable_attach(&mut conn).await.unwrap();
            let row: (i64,) = sqlx::query_as("SELECT 1 + 1")
                .fetch_one(&mut conn)
                .await
                .unwrap();
            assert_eq!(row.0, 2);
        });
    }

    // Canary: fails if a libsqlite3-sys/sqlx bump reopens the ATTACH escape surface.
    #[test]
    fn dangerous_sql_surface_is_closed() {
        block_on(async {
            let mut conn = open_mem().await;
            disable_attach(&mut conn).await.unwrap();

            async fn err(conn: &mut SqliteConnection, sql: &str) -> String {
                sqlx::query(sql)
                    .execute(conn)
                    .await
                    .expect_err(sql)
                    .to_string()
                    .to_ascii_lowercase()
            }

            // Native extension loading disabled by default.
            assert!(
                err(&mut conn, "SELECT load_extension('/nonexistent')")
                    .await
                    .contains("not authorized")
            );
            // fileio (readfile/writefile) not compiled in.
            assert!(
                err(&mut conn, "SELECT readfile('/etc/hosts')")
                    .await
                    .contains("no such function")
            );
            assert!(
                err(&mut conn, "SELECT writefile('/tmp/x', 'y')")
                    .await
                    .contains("no such function")
            );
            // The RCE-capable 2-arg fts3_tokenizer pointer form is disabled.
            assert!(
                err(&mut conn, "SELECT fts3_tokenizer('t', x'0000000000000000')")
                    .await
                    .contains("disabled")
            );
            // VACUUM INTO writes through an attach, so the attach limit blocks it.
            let vac = "/tmp/sqlx_canary_vacuum.db";
            assert!(
                err(&mut conn, &format!("VACUUM INTO '{vac}'"))
                    .await
                    .contains("attached")
            );
            assert!(!std::path::Path::new(vac).exists());
        });
    }
}

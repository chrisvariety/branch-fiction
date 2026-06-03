use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::{
    Json,
    body::Body,
    extract::{Path as AxumPath, State},
    http::{HeaderMap, Method, StatusCode, Uri},
};
use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::db_path::{open_main_db_ro, open_main_db_rw};
use crate::import_db::sync_import_to_main;
use crate::provider_proxy::{ResolvedProvider, forward_to_provider};
use crate::provider_resolve::{
    PI_TEXT, PI_TEXT_LIGHT, resolve_text_model_meta, resolve_text_model_transport,
};

const TOKEN_PREFIX: &str = "pwt_";

// Which book_imports column binds a given pipeline slot to a provider model.
fn provider_model_column_for_slot(slot: &str) -> Option<&'static str> {
    match slot {
        PI_TEXT => Some("text_provider_model_id"),
        PI_TEXT_LIGHT => Some("text_light_provider_model_id"),
        _ => None,
    }
}

// Returns the provider_model bound to `slot` for this import, or None if the provider was deleted.
async fn bound_provider_model_id(
    conn: &mut sqlx::SqliteConnection,
    book_import_id: &str,
    slot: &str,
) -> Result<Option<String>, String> {
    let Some(col) = provider_model_column_for_slot(slot) else {
        return Ok(None);
    };
    let row: Option<(Option<String>,)> =
        sqlx::query_as(&format!("SELECT {col} FROM book_imports WHERE id = ?1"))
            .bind(book_import_id)
            .fetch_optional(conn)
            .await
            .map_err(|e| format!("book_imports {col} query: {e}"))?;
    Ok(row.and_then(|r| r.0))
}

#[derive(Clone, Default)]
pub struct PipelineBridgeState {
    sessions: Arc<Mutex<HashMap<String, BridgeSession>>>,
}

#[derive(Clone)]
struct BridgeSession {
    book_import_id: String,
}

impl PipelineBridgeState {
    pub fn mint(&self, book_import_id: &str) -> String {
        let token = format!("{TOKEN_PREFIX}{}", Uuid::new_v4().simple());
        let mut map = self.sessions.lock().expect("pipeline bridge poisoned");
        map.insert(
            token.clone(),
            BridgeSession {
                book_import_id: book_import_id.to_string(),
            },
        );
        token
    }

    pub fn revoke(&self, token: &str) {
        let mut map = self.sessions.lock().expect("pipeline bridge poisoned");
        map.remove(token);
    }

    fn lookup(&self, token: &str) -> Option<BridgeSession> {
        let map = self.sessions.lock().expect("pipeline bridge poisoned");
        map.get(token).cloned()
    }
}

pub async fn system_proxy_handler(
    State(app): State<AppHandle>,
    AxumPath((token, slot, rest)): AxumPath<(String, String, String)>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let state = app.state::<PipelineBridgeState>();
    let session = state
        .lookup(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "unknown bridge token".to_string()))?;

    let resolved = resolve_slot(&app, &session.book_import_id, &slot)
        .await
        .map_err(|e| {
            eprintln!("[proxy] slot={slot} resolve failed: {e}");
            (StatusCode::BAD_GATEWAY, e)
        })?;

    forward_to_provider(&slot, resolved, &rest, method, uri.query(), headers, body).await
}

#[derive(Serialize)]
pub struct SlotInfo {
    #[serde(rename = "providerType")]
    provider_type: String,
    #[serde(rename = "modelId")]
    model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<String>,
}

pub async fn resolve_slots_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
) -> Result<Json<HashMap<String, SlotInfo>>, (StatusCode, String)> {
    let state = app.state::<PipelineBridgeState>();
    let session = state
        .lookup(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "unknown bridge token".to_string()))?;

    let map = collect_slot_info(&app, &session.book_import_id)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
    Ok(Json(map))
}

pub async fn sync_import_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let session = app
        .state::<PipelineBridgeState>()
        .lookup(&token)
        .ok_or((StatusCode::UNAUTHORIZED, "unknown bridge token".to_string()))?;

    sync_import_to_main(&app, &session.book_import_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn resolve_slot(
    app: &AppHandle,
    book_import_id: &str,
    slot: &str,
) -> Result<ResolvedProvider, String> {
    let mut conn = open_main_db_ro(app).await?;
    let pmid = bound_provider_model_id(&mut conn, book_import_id, slot)
        .await?
        .ok_or_else(|| format!("no provider model bound for slot {slot:?}"))?;
    let _ = conn.close().await;
    resolve_text_model_transport(app, &pmid, slot).await
}

async fn collect_slot_info(
    app: &AppHandle,
    book_import_id: &str,
) -> Result<HashMap<String, SlotInfo>, String> {
    let mut conn = open_main_db_ro(app).await?;
    let mut bound: Vec<(&'static str, String)> = Vec::new();
    for slot in [PI_TEXT, PI_TEXT_LIGHT] {
        if let Some(pmid) = bound_provider_model_id(&mut conn, book_import_id, slot).await? {
            bound.push((slot, pmid));
        }
    }
    let _ = conn.close().await;

    let mut out: HashMap<String, SlotInfo> = HashMap::new();
    for (slot, pmid) in bound {
        let meta = resolve_text_model_meta(app, &pmid, slot).await?;
        out.insert(
            slot.to_string(),
            SlotInfo {
                provider_type: meta.provider_type,
                model_id: meta.model_key,
                reasoning: meta.reasoning,
            },
        );
    }
    Ok(out)
}

fn require_session(app: &AppHandle, token: &str) -> Result<BridgeSession, (StatusCode, String)> {
    app.state::<PipelineBridgeState>()
        .lookup(token)
        .ok_or((StatusCode::UNAUTHORIZED, "unknown bridge token".to_string()))
}

fn db_err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

async fn fetch_row_as_json(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
    key_col: &str,
    key_val: &str,
) -> Result<Option<serde_json::Value>, String> {
    let cols: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as(&format!("PRAGMA table_info(\"{table}\")"))
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| format!("table_info({table}): {e}"))?;
    if cols.is_empty() {
        return Err(format!("table {table} has no columns"));
    }
    let select = cols
        .iter()
        .map(|(_, name, _, _, _, _)| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("SELECT {select} FROM \"{table}\" WHERE \"{key_col}\" = ?1");
    let row = sqlx::query(&sql)
        .bind(key_val)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| format!("select {table}: {e}"))?;
    let Some(row) = row else { return Ok(None) };
    let mut obj = serde_json::Map::new();
    for (i, (_, col, _, _, _, _)) in cols.iter().enumerate() {
        let key = camel_case(col);
        obj.insert(key, sqlite_value_to_json(&row, i)?);
    }
    Ok(Some(serde_json::Value::Object(obj)))
}

fn sqlite_value_to_json(
    row: &sqlx::sqlite::SqliteRow,
    i: usize,
) -> Result<serde_json::Value, String> {
    use sqlx::TypeInfo;
    use sqlx::ValueRef;
    let raw = row
        .try_get_raw(i)
        .map_err(|e| format!("get_raw({i}): {e}"))?;
    if raw.is_null() {
        return Ok(serde_json::Value::Null);
    }
    let ty = raw.type_info();
    let name = ty.name();
    Ok(match name {
        "INTEGER" | "BIGINT" | "INT" => row
            .try_get::<Option<i64>, _>(i)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),
        "REAL" | "FLOAT" | "DOUBLE" => row
            .try_get::<Option<f64>, _>(i)
            .ok()
            .flatten()
            .and_then(|v| serde_json::Number::from_f64(v).map(serde_json::Value::Number))
            .unwrap_or(serde_json::Value::Null),
        "BLOB" => row
            .try_get::<Option<Vec<u8>>, _>(i)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::Array(v.into_iter().map(serde_json::Value::from).collect()))
            .unwrap_or(serde_json::Value::Null),
        _ => match row.try_get::<Option<String>, _>(i).ok().flatten() {
            Some(ref s) if s == "true" => serde_json::Value::Bool(true),
            Some(ref s) if s == "false" => serde_json::Value::Bool(false),
            Some(s) => serde_json::Value::String(s),
            None => serde_json::Value::Null,
        },
    })
}

fn camel_case(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut upper_next = false;
    for ch in snake.chars() {
        if ch == '_' {
            upper_next = true;
        } else if upper_next {
            out.extend(ch.to_uppercase());
            upper_next = false;
        } else {
            out.push(ch);
        }
    }
    out
}

#[derive(Deserialize, Default)]
pub struct BookImportUpdate {
    #[serde(default)]
    status: Option<String>,
    #[serde(rename = "lastError", default, deserialize_with = "deserialize_some")]
    last_error: Option<Option<String>>,
    #[serde(rename = "bookId", default, deserialize_with = "deserialize_some")]
    book_id: Option<Option<String>>,
    #[serde(
        rename = "etaMinSeconds",
        default,
        deserialize_with = "deserialize_some"
    )]
    eta_min_seconds: Option<Option<i64>>,
    #[serde(
        rename = "etaMaxSeconds",
        default,
        deserialize_with = "deserialize_some"
    )]
    eta_max_seconds: Option<Option<i64>>,
    #[serde(
        rename = "costMinCents",
        default,
        deserialize_with = "deserialize_some"
    )]
    cost_min_cents: Option<Option<i64>>,
    #[serde(
        rename = "costMaxCents",
        default,
        deserialize_with = "deserialize_some"
    )]
    cost_max_cents: Option<Option<i64>>,
    #[serde(
        rename = "projectionBehavior",
        default,
        deserialize_with = "deserialize_some"
    )]
    projection_behavior: Option<Option<String>>,
    #[serde(rename = "incrementErrorCount", default)]
    increment_error_count: bool,
}

fn deserialize_some<'de, T, D>(d: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(d).map(Some)
}

pub async fn get_book_import_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
) -> Result<Json<Option<serde_json::Value>>, (StatusCode, String)> {
    let session = require_session(&app, &token)?;
    let mut conn = open_main_db_ro(&app).await.map_err(db_err)?;
    let row = fetch_row_as_json(&mut conn, "book_imports", "id", &session.book_import_id)
        .await
        .map_err(db_err)?;
    let _ = conn.close().await;
    Ok(Json(row))
}

enum BindValue {
    Text(Option<String>),
    Integer(Option<i64>),
}

pub async fn update_book_import_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(update): Json<BookImportUpdate>,
) -> Result<StatusCode, (StatusCode, String)> {
    let session = require_session(&app, &token)?;
    let mut sets: Vec<&'static str> = Vec::new();
    let mut binds: Vec<BindValue> = Vec::new();
    if let Some(v) = &update.status {
        sets.push("status");
        binds.push(BindValue::Text(Some(v.clone())));
    }
    if let Some(v) = &update.last_error {
        sets.push("last_error");
        binds.push(BindValue::Text(v.clone()));
    }
    if let Some(v) = &update.book_id {
        sets.push("book_id");
        binds.push(BindValue::Text(v.clone()));
    }
    if let Some(v) = &update.eta_min_seconds {
        sets.push("eta_min_seconds");
        binds.push(BindValue::Integer(*v));
    }
    if let Some(v) = &update.eta_max_seconds {
        sets.push("eta_max_seconds");
        binds.push(BindValue::Integer(*v));
    }
    if let Some(v) = &update.cost_min_cents {
        sets.push("cost_min_cents");
        binds.push(BindValue::Integer(*v));
    }
    if let Some(v) = &update.cost_max_cents {
        sets.push("cost_max_cents");
        binds.push(BindValue::Integer(*v));
    }
    if let Some(v) = &update.projection_behavior {
        sets.push("projection_behavior");
        binds.push(BindValue::Text(v.clone()));
    }
    let mut assignments: Vec<String> = sets
        .iter()
        .enumerate()
        .map(|(i, col)| format!("{col} = ?{}", i + 1))
        .collect();
    if update.increment_error_count {
        assignments.push("error_count = COALESCE(error_count, 0) + 1".to_string());
    }
    if assignments.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }
    assignments.push("updated_at = CURRENT_TIMESTAMP".to_string());
    let id_placeholder = sets.len() + 1;
    let sql = format!(
        "UPDATE book_imports SET {} WHERE id = ?{id_placeholder}",
        assignments.join(", ")
    );
    let mut conn = open_main_db_rw(&app).await.map_err(db_err)?;
    let mut q = sqlx::query(&sql);
    for v in &binds {
        q = match v {
            BindValue::Text(s) => q.bind(s),
            BindValue::Integer(n) => q.bind(n),
        };
    }
    q = q.bind(&session.book_import_id);
    q.execute(&mut conn).await.map_err(db_err)?;
    let _ = conn.close().await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_book_handler(
    State(app): State<AppHandle>,
    AxumPath((token, id)): AxumPath<(String, String)>,
) -> Result<Json<Option<serde_json::Value>>, (StatusCode, String)> {
    let _ = require_session(&app, &token)?;
    let mut conn = open_main_db_ro(&app).await.map_err(db_err)?;
    let row = fetch_row_as_json(&mut conn, "books", "id", &id)
        .await
        .map_err(db_err)?;
    let _ = conn.close().await;
    Ok(Json(row))
}

#[derive(Deserialize)]
pub struct CreateBookRequest {
    id: String,
    #[serde(rename = "userId")]
    user_id: String,
    #[serde(rename = "shareCode")]
    share_code: String,
    #[serde(rename = "baseSlug")]
    base_slug: String,
    title: String,
    #[serde(default)]
    isbn: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    publisher: Option<String>,
    #[serde(rename = "imageUrl", default)]
    image_url: Option<String>,
}

pub async fn create_book_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(req): Json<CreateBookRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let _ = require_session(&app, &token)?;
    let mut conn = open_main_db_rw(&app).await.map_err(db_err)?;
    let mut tx = conn.begin().await.map_err(db_err)?;

    let final_slug = find_available_slug(&mut tx, &req.base_slug)
        .await
        .map_err(db_err)?;

    sqlx::query(
        "INSERT INTO books (id, user_id, share_code, slug, title, isbn, language, publisher, image_url) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
    .bind(&req.id)
    .bind(&req.user_id)
    .bind(&req.share_code)
    .bind(&final_slug)
    .bind(&req.title)
    .bind(&req.isbn)
    .bind(&req.language)
    .bind(&req.publisher)
    .bind(&req.image_url)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;

    tx.commit().await.map_err(db_err)?;
    let row = fetch_row_as_json(&mut conn, "books", "id", &req.id)
        .await
        .map_err(db_err)?;
    let _ = conn.close().await;
    row.map(Json).ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        "books row missing after insert".into(),
    ))
}

async fn find_available_slug(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    base_slug: &str,
) -> Result<String, String> {
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM books WHERE slug = ?1")
        .bind(base_slug)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| format!("slug check: {e}"))?;
    if exists.is_none() {
        return Ok(base_slug.to_string());
    }
    for i in 1..=10 {
        let candidate = format!("{base_slug}-{i}");
        let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM books WHERE slug = ?1")
            .bind(&candidate)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| format!("slug check: {e}"))?;
        if exists.is_none() {
            return Ok(candidate);
        }
    }
    let suffix = (Uuid::new_v4().as_u128() % 1_000_000) as u32;
    Ok(format!("{base_slug}-{suffix}"))
}

#[derive(Deserialize, Default)]
pub struct BookUpdate {
    #[serde(
        rename = "characterRankType",
        default,
        deserialize_with = "deserialize_some"
    )]
    character_rank_type: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    status: Option<Option<String>>,
}

pub async fn update_book_handler(
    State(app): State<AppHandle>,
    AxumPath((token, id)): AxumPath<(String, String)>,
    Json(update): Json<BookUpdate>,
) -> Result<StatusCode, (StatusCode, String)> {
    let _ = require_session(&app, &token)?;
    let mut sets: Vec<&'static str> = Vec::new();
    let mut binds: Vec<Option<String>> = Vec::new();
    if let Some(v) = &update.character_rank_type {
        sets.push("character_rank_type");
        binds.push(v.clone());
    }
    if let Some(v) = &update.status {
        sets.push("status");
        binds.push(v.clone());
    }
    if sets.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }
    let assignments = sets
        .iter()
        .enumerate()
        .map(|(i, col)| format!("{col} = ?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let id_placeholder = sets.len() + 1;
    let sql = format!(
        "UPDATE books SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?{id_placeholder}"
    );
    let mut conn = open_main_db_rw(&app).await.map_err(db_err)?;
    let mut q = sqlx::query(&sql);
    for v in &binds {
        q = q.bind(v);
    }
    q = q.bind(&id);
    q.execute(&mut conn).await.map_err(db_err)?;
    let _ = conn.close().await;
    Ok(StatusCode::NO_CONTENT)
}

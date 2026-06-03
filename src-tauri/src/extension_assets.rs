use std::path::{Component, Path, PathBuf};

use axum::{
    extract::{Path as AxumPath, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use sqlx::Connection;
use tauri::AppHandle;
use tokio::fs;

use crate::db_path::open_main_db_ro;

pub async fn assets_handler(
    State(app): State<AppHandle>,
    AxumPath((extension_id, rest)): AxumPath<(String, String)>,
    req_headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    if has_traversal(&rest) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let install_dir = lookup_install_dir(&app, &extension_id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    let path = install_dir.join(&rest);
    let canonical = std::fs::canonicalize(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    let canonical_root = std::fs::canonicalize(&install_dir).map_err(|_| StatusCode::NOT_FOUND)?;
    if !canonical.starts_with(&canonical_root) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let bytes = fs::read(&canonical)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(guess_content_type(&canonical)) {
        headers.insert(header::CONTENT_TYPE, v);
    }
    // Sandboxed iframe has opaque origin; list host explicitly in CSP. In dev, prefer X-Forwarded-Host (Vite xfwd).
    let host = req_headers
        .get("x-forwarded-host")
        .and_then(|v| v.to_str().ok())
        .or_else(|| req_headers.get(header::HOST).and_then(|v| v.to_str().ok()))
        .unwrap_or("127.0.0.1");
    let scheme = req_headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    let self_origin = format!("{scheme}://{host}");
    let csp = format!(
        "default-src {origin} data: blob:; \
         script-src {origin} 'unsafe-inline' 'unsafe-eval'; \
         style-src {origin} 'unsafe-inline'; \
         img-src {origin} data: blob:; \
         media-src {origin} data: blob:; \
         font-src {origin} data:; \
         connect-src {origin}",
        origin = self_origin
    );
    if let Ok(v) = HeaderValue::from_str(&csp) {
        headers.insert(header::CONTENT_SECURITY_POLICY, v);
    }
    Ok((headers, bytes))
}

async fn lookup_install_dir(app: &AppHandle, extension_id: &str) -> Option<PathBuf> {
    let mut conn = open_main_db_ro(app).await.ok()?;
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT path FROM extensions WHERE id = ?1")
            .bind(extension_id)
            .fetch_optional(&mut conn)
            .await
            .ok()?;
    let _ = conn.close().await;
    row.and_then(|(p,)| p).map(PathBuf::from)
}

fn has_traversal(s: &str) -> bool {
    PathBuf::from(s).components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    })
}

fn guess_content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

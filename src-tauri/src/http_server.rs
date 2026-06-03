use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::path::{Component, Path, PathBuf};

use axum::{
    Router,
    extract::{ConnectInfo, Path as AxumPath, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post},
};
use tauri::{AppHandle, Manager};
use tokio::fs;

use tower_http::cors::{Any, CorsLayer};
#[cfg(not(debug_assertions))]
use tower_http::services::ServeDir;

use crate::extension_assets::assets_handler;
use crate::extension_data_proxy::{
    context_handler, db_query_handler, fs_list_handler, fs_read_handler, fs_write_handler,
    public_asset_handler,
};
use crate::extension_dev::{pair_handler, prepare_db_handler};
use crate::extension_proxy::proxy_handler;
use crate::extension_sdk::{ExtensionSdkState, sdk_handler};
use crate::extension_task_sse::{cancel_task_handler, start_task_handler};
use crate::phone_share::{PhoneShareState, phone_share_redirect_handler};
use crate::pipeline_bridge::{
    create_book_handler, get_book_handler, get_book_import_handler, resolve_slots_handler,
    sync_import_handler, system_proxy_handler, update_book_handler, update_book_import_handler,
};
use crate::test_provider::test_provider_proxy_handler;

pub const PREFERRED_HTTP_PORT: u16 = 1421;

/// resolved listening port (could be different from `PREFERRED_HTTP_PORT`)
pub struct HttpPortState(pub u16);

#[derive(Clone)]
struct AssetState {
    storage_dir: PathBuf,
}

pub fn spawn(app: &AppHandle) -> Result<u16, String> {
    let storage_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?
        .join("storage");

    let listener = match StdTcpListener::bind(("0.0.0.0", PREFERRED_HTTP_PORT)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "http server: preferred port {PREFERRED_HTTP_PORT} unavailable ({e}), \
                 falling back to OS-assigned port"
            );
            StdTcpListener::bind("0.0.0.0:0").map_err(|e| format!("bind failed: {e}"))?
        }
    };
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("set_nonblocking failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr failed: {e}"))?
        .port();

    #[cfg(not(debug_assertions))]
    let dist_dir = match resolve_dist_dir(app) {
        Ok(p) => Some(p),
        Err(e) => {
            eprintln!("http server: could not resolve dist dir: {e}");
            None
        }
    };
    #[cfg(debug_assertions)]
    let dist_dir: Option<PathBuf> = None;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(
        async move { run(listener, storage_dir, dist_dir, app_handle).await },
    );

    Ok(port)
}

#[cfg(not(debug_assertions))]
fn resolve_dist_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    // tauri.conf.json maps "../dist" -> "dist", so the built frontend lands directly in Resources/dist
    Ok(resource_dir.join("dist"))
}

async fn run(
    listener: StdTcpListener,
    storage_dir: PathBuf,
    dist_dir: Option<PathBuf>,
    app: AppHandle,
) {
    let state = AssetState { storage_dir };

    // TODO lock this down a bit?
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Routes reachable by phone clients (only while a share is live); unlisted routes are loopback-only by default.
    let extension_routes: Router = Router::new()
        .route(
            "/extension-providers/{token}/{provider_key}/{*rest}",
            any(proxy_handler),
        )
        .route("/extension-data/{token}/db/query", post(db_query_handler))
        .route("/extension-data/{token}/fs/read", post(fs_read_handler))
        .route("/extension-data/{token}/fs/write", post(fs_write_handler))
        .route("/extension-data/{token}/fs/list", post(fs_list_handler))
        .route("/extension-data/{token}/context", get(context_handler))
        .route(
            "/extension-data/{token}/task/start",
            post(start_task_handler),
        )
        .route(
            "/extension-data/{token}/task/{task_id}/cancel",
            post(cancel_task_handler),
        )
        .route(
            "/extension-data/{extension_id}/assets/{*rest}",
            get(public_asset_handler),
        )
        .route(
            "/extension-assets/{extension_id}/{*rest}",
            get(assets_handler),
        )
        .route("/p/{slug}", get(phone_share_redirect_handler))
        .with_state(app.clone());

    let sdk_state = app.state::<ExtensionSdkState>().inner().clone();
    let sdk_router: Router = Router::new()
        .route("/extension-sdk.js", get(sdk_handler))
        .with_state(sdk_state);

    let assets_router: Router = Router::new()
        .route("/assets/{bucket}/{*key}", get(serve_asset))
        .with_state(state);

    let phone_share_router: Router = Router::new()
        .merge(extension_routes)
        .merge(sdk_router)
        .merge(assets_router);

    #[cfg(not(debug_assertions))]
    let phone_share_router = match dist_dir {
        Some(dir) => {
            eprintln!("http server: serving dist {}", dir.display());
            phone_share_router.fallback_service(ServeDir::new(dir))
        }
        None => phone_share_router,
    };
    #[cfg(debug_assertions)]
    let _ = dist_dir;

    let phone_share_router = phone_share_router.layer(middleware::from_fn_with_state(
        app.clone(),
        phone_share_guard,
    ));

    // Loopback-only routes: dev pairing, pipeline bridge, and provider test harness.
    let local_router: Router = Router::new()
        .route(
            "/test-provider/{token}/{*rest}",
            any(test_provider_proxy_handler),
        )
        .route("/v1/extension-dev/pair", post(pair_handler))
        .route(
            "/v1/extension-dev/extension-db/prepare",
            post(prepare_db_handler),
        )
        .route(
            "/system-proxy/{token}/{slot}/{*rest}",
            any(system_proxy_handler),
        )
        .route(
            "/v1/worker/{token}/slots/resolve",
            get(resolve_slots_handler),
        )
        .route("/v1/worker/{token}/import/sync", post(sync_import_handler))
        .route(
            "/v1/worker/{token}/book-import",
            get(get_book_import_handler),
        )
        .route(
            "/v1/worker/{token}/book-import/update",
            post(update_book_import_handler),
        )
        .route("/v1/worker/{token}/books/{id}", get(get_book_handler))
        .route("/v1/worker/{token}/books", post(create_book_handler))
        .route(
            "/v1/worker/{token}/books/{id}/update",
            post(update_book_handler),
        )
        .with_state(app.clone())
        .layer(middleware::from_fn(loopback_only_guard));

    let router = Router::new()
        .merge(phone_share_router)
        .merge(local_router)
        .layer(cors);

    let listener = match tokio::net::TcpListener::from_std(listener) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("http server: could not adopt listener: {e}");
            return;
        }
    };
    let bind = listener
        .local_addr()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "?".to_string());
    eprintln!("http server: listening on {bind}");
    let make_service = router.into_make_service_with_connect_info::<SocketAddr>();
    if let Err(e) = axum::serve(listener, make_service).await {
        eprintln!("http server: serve error: {e}");
    }
}

// Bound on 0.0.0.0; LAN access gated per route group — loopback always allowed, phone-share group only while live.
fn forbidden() -> Response {
    (StatusCode::FORBIDDEN, "forbidden").into_response()
}

fn phone_share_allows(is_loopback: bool, share_active: bool) -> bool {
    is_loopback || share_active
}

// Middleware: admits off-machine peers only while a phone share is registered.
async fn phone_share_guard(
    State(app): State<AppHandle>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    let share_active = app.state::<PhoneShareState>().has_active();
    if phone_share_allows(peer.ip().is_loopback(), share_active) {
        return next.run(req).await;
    }
    forbidden()
}

// Applied to routes that must never be reachable off-machine.
async fn loopback_only_guard(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    if peer.ip().is_loopback() {
        return next.run(req).await;
    }
    forbidden()
}

#[tauri::command]
pub fn get_http_port(state: tauri::State<'_, HttpPortState>) -> u16 {
    state.0
}

async fn serve_asset(
    State(state): State<AssetState>,
    AxumPath((bucket, key)): AxumPath<(String, String)>,
) -> Result<impl IntoResponse, StatusCode> {
    if has_traversal(&bucket) || has_traversal(&key) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let path = state.storage_dir.join(&bucket).join(&key);
    let bytes = fs::read(&path).await.map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(([(header::CONTENT_TYPE, guess_content_type(&path))], bytes))
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
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::phone_share_allows;

    #[test]
    fn loopback_always_reaches_phone_share_group() {
        assert!(phone_share_allows(true, false));
        assert!(phone_share_allows(true, true));
    }

    #[test]
    fn off_machine_reaches_phone_share_group_only_while_sharing() {
        assert!(!phone_share_allows(false, false));
        assert!(phone_share_allows(false, true));
    }
}

use std::convert::Infallible;
use std::time::Duration;

use axum::{
    Json,
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::stream::{self, Stream, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Connection;
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::db_path::open_main_db_ro;
use crate::extension_auth::verify_path_token;
use crate::extension_data_proxy::inject_proxy_base_urls;
use crate::extension_runtime::{
    ExtensionTaskEvent, RunExtensionTaskRequest, cancel_task_by_id, register_task,
    run_extension_task_internal, unregister_task,
};
use crate::http_server::HttpPortState;

#[derive(Deserialize)]
pub struct StartTaskBody {
    pub task: String,
    #[serde(default)]
    pub payload: Option<Value>,
}

pub async fn start_task_handler(
    State(app): State<AppHandle>,
    AxumPath(token): AxumPath<String>,
    Json(body): Json<StartTaskBody>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    let claims = verify_path_token(&app, &token)?;

    let (install_dir, worker_path, net_allowlist) = load_extension_runtime_meta(&app, &claims.sub)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let port = app.state::<HttpPortState>().0;
    let providers_with_urls = inject_proxy_base_urls(
        claims.providers.clone(),
        &format!("127.0.0.1:{port}"),
        &token,
    );

    let req = RunExtensionTaskRequest {
        extension_id: claims.sub.clone(),
        book_id: claims.book_id.clone(),
        extension_install_dir: install_dir,
        extension_worker_path: worker_path,
        task: body.task,
        payload: body.payload,
        providers: Value::Object(providers_with_urls),
        config: claims.config.clone(),
        net_allowlist,
    };

    let task_id = format!("ptk_{}", Uuid::new_v4().simple());
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let (event_tx, event_rx) = mpsc::channel::<ExtensionTaskEvent>(64);

    if !register_task(&app, &task_id, cancel_tx) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "task id collision".to_string(),
        ));
    }

    let app_for_run = app.clone();
    tauri::async_runtime::spawn(async move {
        run_extension_task_internal(app_for_run, req, event_tx, cancel_rx).await;
    });

    let started = Event::default()
        .event("started")
        .json_data(json!({ "taskId": task_id }))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("sse encode: {e}"),
            )
        })?;

    let init_state = StreamState {
        rx: event_rx,
        guard: ExtensionTaskGuard {
            app: app.clone(),
            task_id: task_id.clone(),
            terminal_seen: false,
        },
    };

    let body_stream = stream::unfold(init_state, |mut state| async move {
        let next = state.rx.recv().await?;
        let (event, terminal) = render_event(next);
        if terminal {
            state.guard.terminal_seen = true;
        }
        Some((Ok::<Event, Infallible>(event), state))
    });

    let combined = stream::once(async move { Ok::<Event, Infallible>(started) }).chain(body_stream);

    Ok(Sse::new(combined).keep_alive(KeepAlive::default().interval(Duration::from_secs(15))))
}

pub async fn cancel_task_handler(
    State(app): State<AppHandle>,
    AxumPath((token, task_id)): AxumPath<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    let _ = verify_path_token(&app, &token)?;
    cancel_task_by_id(&app, &task_id);
    Ok(StatusCode::NO_CONTENT)
}

fn render_event(ev: ExtensionTaskEvent) -> (Event, bool) {
    match ev {
        ExtensionTaskEvent::Log(args) => {
            let event = Event::default()
                .event("log")
                .json_data(json!({ "args": args }))
                .unwrap_or_else(|_| Event::default().event("log").data("[]"));
            (event, false)
        }
        ExtensionTaskEvent::Result(value) => {
            let event = Event::default()
                .event("result")
                .json_data(json!({ "value": value }))
                .unwrap_or_else(|_| Event::default().event("result").data("null"));
            (event, true)
        }
        ExtensionTaskEvent::Error(message) => {
            let event = Event::default()
                .event("error")
                .json_data(json!({ "message": message }))
                .unwrap_or_else(|_| {
                    Event::default()
                        .event("error")
                        .data("{\"message\":\"unknown\"}")
                });
            (event, true)
        }
    }
}

struct StreamState {
    rx: mpsc::Receiver<ExtensionTaskEvent>,
    guard: ExtensionTaskGuard,
}

struct ExtensionTaskGuard {
    app: AppHandle,
    task_id: String,
    terminal_seen: bool,
}

impl Drop for ExtensionTaskGuard {
    fn drop(&mut self) {
        if !self.terminal_seen {
            // Client disconnected without a terminal event; cancel to avoid leaking a Deno child.
            cancel_task_by_id(&self.app, &self.task_id);
        }
        unregister_task(&self.app, &self.task_id);
    }
}

async fn load_extension_runtime_meta(
    app: &AppHandle,
    extension_id: &str,
) -> Result<(String, String, Vec<String>), String> {
    let mut conn = open_main_db_ro(app).await?;

    let row: Option<(String, String, i64)> =
        sqlx::query_as("SELECT path, manifest, enabled FROM extensions WHERE id = ?1")
            .bind(extension_id)
            .fetch_optional(&mut conn)
            .await
            .map_err(|e| format!("extensions query: {e}"))?;
    let _ = conn.close().await;

    let (path, manifest_json, enabled) =
        row.ok_or_else(|| format!("extension not found: {extension_id}"))?;
    if enabled == 0 {
        return Err(format!("extension disabled: {extension_id}"));
    }
    if path.is_empty() {
        return Err(format!("extension {extension_id} has no install path"));
    }

    let manifest: Value =
        serde_json::from_str(&manifest_json).map_err(|e| format!("manifest parse: {e}"))?;

    let worker_entry = manifest
        .get("path")
        .and_then(|e| e.get("worker"))
        .and_then(|w| w.as_str())
        .ok_or_else(|| format!("extension {extension_id} has no path.worker entry"))?
        .to_string();

    let net_allowlist = manifest
        .get("net")
        .and_then(|n| n.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let worker_path = join_path(&path, &worker_entry);
    Ok((path, worker_path, net_allowlist))
}

fn join_path(dir: &str, rel: &str) -> String {
    let trimmed_dir = dir.trim_end_matches('/');
    let trimmed_rel = rel.trim_start_matches("./").trim_start_matches('/');
    format!("{trimmed_dir}/{trimmed_rel}")
}

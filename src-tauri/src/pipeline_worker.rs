use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{Value, json};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::oneshot;

use crate::db_path::main_db_path;
use crate::http_server::HttpPortState;
use crate::import_db::{delete_import_db, prepare_import_db};
use crate::keepawake::{KeepawakeState, allow_sleep, prevent_sleep};
use crate::pipeline_bridge::PipelineBridgeState;

/// Per-import kill channel. The state's keys double as the "running imports"
/// set surfaced by `list_running_book_imports`.
#[derive(Default)]
pub struct PipelineWorkerState {
    pub(crate) children: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

const INIT_REQUEST_ID: u64 = 1;
const RUN_IMPORT_REQUEST_ID: u64 = 2;

#[tauri::command]
pub async fn start_book_import(
    app: AppHandle,
    state: State<'_, PipelineWorkerState>,
    book_import_id: String,
    retry_failed: Option<bool>,
) -> Result<(), String> {
    let run_request = json!({
        "jsonrpc": "2.0",
        "id": RUN_IMPORT_REQUEST_ID,
        "method": "runImport",
        "params": [{
            "bookImportId": book_import_id,
            "retryFailed": retry_failed.unwrap_or(false),
        }]
    });
    // The import runs long; return once the worker is up and track it via events.
    spawn_worker(app, state, book_import_id, run_request, false).await
}

/// Re-run minor classification for one character; only valid while import is paused.
#[tauri::command]
pub async fn recheck_book_entity_minor(
    app: AppHandle,
    state: State<'_, PipelineWorkerState>,
    book_import_id: String,
    book_id: String,
    book_entity_id: String,
) -> Result<(), String> {
    let run_request = json!({
        "jsonrpc": "2.0",
        "id": RUN_IMPORT_REQUEST_ID,
        "method": "recheckMinor",
        "params": [{
            "bookImportId": book_import_id,
            "bookId": book_id,
            "focusBookEntityId": book_entity_id,
        }]
    });
    // A recheck is short; keep the call pending until the work actually finishes
    // so the UI can show progress for its full duration.
    spawn_worker(app, state, book_import_id, run_request, true).await
}

async fn spawn_worker(
    app: AppHandle,
    state: State<'_, PipelineWorkerState>,
    book_import_id: String,
    run_request: Value,
    await_run: bool,
) -> Result<(), String> {
    {
        let map = state.children.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&book_import_id) {
            return Err(format!("import already running: {book_import_id}"));
        }
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let dir_str = app_data_dir.to_string_lossy().to_string();
    let bundle_path = app
        .path()
        .resolve(
            "resources/pipeline-worker.bundle.js",
            BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve bundle: {e}"))?;
    let bundle_str = bundle_path.to_string_lossy().to_string();
    let main_path = main_db_path(&app)?.to_string_lossy().to_string();
    let import_db_path = prepare_import_db(&app, &book_import_id).await?;
    let db_path = import_db_path.to_string_lossy().to_string();

    eprintln!("[pipeline-worker] app_data_dir={dir_str}");
    eprintln!(
        "[pipeline-worker] bundle={bundle_str} (exists={})",
        bundle_path.exists()
    );

    let bridge_token = app.state::<PipelineBridgeState>().mint(&book_import_id);
    let bridge_port = app.state::<HttpPortState>().0;

    let provider_env_vars = read_provider_env_var_names(&main_path)
        .await
        .unwrap_or_else(|e| {
            eprintln!("[pipeline-worker] failed to read provider env vars: {e}");
            Vec::new()
        });

    let mut env_allowlist = vec![
        "HOME",
        "NODE_ENV",
        "CI",
        "DEBUG",
        // pi-ai prompt cache TTL ("long" = 1h where supported)
        "PI_CACHE_RETENTION",
        // optional! LangSmith tracing only if you have LANGSMITH_API_KEY set
        "LANGSMITH_API_KEY",
        "LANGSMITH_PROJECT",
        "LANGSMITH_CONFIG_FILE",
    ]
    .into_iter()
    .map(String::from)
    .collect::<Vec<_>>();
    env_allowlist.extend(provider_env_vars);

    // langsmith reads ~/.langsmith/config.json by default; point it at a
    // non-existent file next to the import db so existsSync short-circuits
    // without needing $HOME read permission.
    let langsmith_noop_config = import_db_path
        .with_file_name(".langsmith-noop-config.json")
        .to_string_lossy()
        .to_string();

    // The worker only touches book-imports/ (its sqlite db, WAL/SHM sidecars,
    // and the langsmith noop path) and reads parsed book JSON from storage/.
    let book_imports_dir = import_db_path
        .parent()
        .ok_or_else(|| "import db path has no parent".to_string())?
        .to_string_lossy()
        .to_string();
    let storage_dir = app_data_dir.join("storage").to_string_lossy().to_string();
    // covered by the recursive storage_dir read grant
    let models_catalog_path = app_data_dir
        .join("storage")
        .join("models-catalog.json")
        .to_string_lossy()
        .to_string();

    let args = vec![
        "run".to_string(),
        "--no-config".to_string(),
        // Non-interactive sidecar: fail ungranted permissions instead of prompting (hangs on Windows).
        "--no-prompt".to_string(),
        format!("--allow-read={},{}", book_imports_dir, storage_dir),
        format!("--allow-write={}", book_imports_dir),
        "--allow-net".to_string(),
        format!("--allow-env={}", env_allowlist.join(",")),
        bundle_str,
    ];

    let (rx, child) = app
        .shell()
        .sidecar("deno")
        .map_err(|e| format!("sidecar lookup: {e}"))?
        .args(args)
        .env("LANGSMITH_CONFIG_FILE", &langsmith_noop_config)
        .env("PI_CACHE_RETENTION", "long")
        .spawn()
        .map_err(|e| format!("sidecar spawn: {e}"))?;

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let (init_done_tx, init_done_rx) = oneshot::channel::<Result<(), String>>();
    let (run_done_tx, run_done_rx) = if await_run {
        let (tx, rx) = oneshot::channel::<Result<(), String>>();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };

    {
        let mut map = state.children.lock().map_err(|e| e.to_string())?;
        map.insert(book_import_id.clone(), kill_tx);
    }

    let keepawake = app.state::<KeepawakeState>();
    let _ = prevent_sleep(keepawake);

    let app_clone = app.clone();
    let import_id = book_import_id.clone();

    let bridge_token_for_task = bridge_token.clone();
    tauri::async_runtime::spawn(async move {
        run_worker_task(
            app_clone,
            import_id,
            run_request,
            db_path,
            models_catalog_path,
            bridge_token_for_task,
            bridge_port,
            child,
            rx,
            init_done_tx,
            run_done_tx,
            kill_rx,
        )
        .await;
    });

    init_done_rx
        .await
        .map_err(|_| "worker died before init".to_string())?
        .inspect_err(|_| {
            if let Ok(mut map) = state.children.lock() {
                map.remove(&book_import_id);
            }
            app.state::<PipelineBridgeState>().revoke(&bridge_token);
        })?;

    if let Some(run_done_rx) = run_done_rx {
        run_done_rx
            .await
            .map_err(|_| "worker died before run completed".to_string())??;
    }

    let _ = app.emit("query:invalidate", &book_import_id);

    Ok(())
}

#[tauri::command]
pub fn cancel_book_import(
    state: State<'_, PipelineWorkerState>,
    book_import_id: String,
) -> Result<(), String> {
    let kill_tx = {
        let mut map = state.children.lock().map_err(|e| e.to_string())?;
        map.remove(&book_import_id)
    };
    if let Some(tx) = kill_tx {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub fn list_running_book_imports(
    state: State<'_, PipelineWorkerState>,
) -> Result<Vec<String>, String> {
    let map = state.children.lock().map_err(|e| e.to_string())?;
    Ok(map.keys().cloned().collect())
}

#[tauri::command]
pub fn is_book_import_running(
    state: State<'_, PipelineWorkerState>,
    book_import_id: String,
) -> Result<bool, String> {
    let map = state.children.lock().map_err(|e| e.to_string())?;
    Ok(map.contains_key(&book_import_id))
}

#[allow(clippy::too_many_arguments)]
async fn run_worker_task(
    app: AppHandle,
    book_import_id: String,
    run_request: Value,
    db_path: String,
    models_catalog_path: String,
    bridge_token: String,
    bridge_port: u16,
    mut child: CommandChild,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    init_done_tx: oneshot::Sender<Result<(), String>>,
    mut run_done_tx: Option<oneshot::Sender<Result<(), String>>>,
    mut kill_rx: oneshot::Receiver<()>,
) {
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": INIT_REQUEST_ID,
        "method": "init",
        "params": [{
            "dbPath": db_path,
            "modelsCatalogPath": models_catalog_path,
            "bridgePort": bridge_port,
            "bridgeToken": bridge_token,
        }]
    });

    let mut cancelled = false;

    if let Err(e) = child.write(format!("{init_req}\n").as_bytes()) {
        let _ = init_done_tx.send(Err(format!("failed to write init request: {e}")));
        let _ = child.kill();
        finalize_worker(&app, &book_import_id);
        return;
    }

    let mut init_done_tx = Some(init_done_tx);

    loop {
        tokio::select! {
            biased;

            _ = &mut kill_rx => {
                eprintln!("[pipeline-worker] cancelled {book_import_id}");
                cancelled = true;
                let _ = child.kill();
                break;
            }

            event = rx.recv() => {
                let Some(event) = event else { break };
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        let trimmed = line.trim();
                        if trimmed.is_empty() { continue; }
                        match serde_json::from_str::<Value>(trimmed) {
                            Ok(msg) => {
                                let id = msg.get("id").and_then(|v| v.as_u64());
                                let error = msg.get("error");
                                let result = msg.get("result");
                                match id {
                                    Some(INIT_REQUEST_ID) => {
                                        if let Some(tx) = init_done_tx.take() {
                                            if let Some(err) = error {
                                                let _ = tx.send(Err(error_message(err)));
                                                let _ = child.kill();
                                                break;
                                            }
                                            let _ = tx.send(Ok(()));
                                            if let Err(e) = child.write(format!("{run_request}\n").as_bytes()) {
                                                eprintln!("[pipeline-worker] failed to write run request: {e}");
                                                let _ = child.kill();
                                                break;
                                            }
                                        }
                                    }
                                    Some(RUN_IMPORT_REQUEST_ID) => {
                                        if let Some(err) = error {
                                            let msg = error_message(err);
                                            eprintln!("[pipeline-worker] run error: {msg}");
                                            if let Some(tx) = run_done_tx.take() {
                                                let _ = tx.send(Err(msg));
                                            }
                                        } else {
                                            if let Some(res) = result {
                                                let status = res
                                                    .get("status")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("unknown");
                                                eprintln!(
                                                    "[pipeline-worker] run done status={status}"
                                                );
                                            }
                                            if let Some(tx) = run_done_tx.take() {
                                                let _ = tx.send(Ok(()));
                                            }
                                        }
                                        let _ = child.kill();
                                        break;
                                    }
                                    _ => {
                                        eprintln!(
                                            "[pipeline-worker stray-stdout] {trimmed}"
                                        );
                                    }
                                }
                            }
                            Err(_) => {
                                eprintln!("[pipeline-worker stray-stdout] {trimmed}");
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        let trimmed = line.trim_end_matches(['\n', '\r']);
                        if !trimmed.is_empty() {
                            eprintln!("[pipeline-worker] {trimmed}");
                        }
                    }
                    CommandEvent::Error(e) => {
                        eprintln!("[pipeline-worker] command error: {e}");
                    }
                    CommandEvent::Terminated(payload) => {
                        eprintln!(
                            "[pipeline-worker] exited code={:?} signal={:?}",
                            payload.code, payload.signal
                        );
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    // Drain remaining stderr after termination so log lines aren't lost.
    while let Ok(Some(event)) =
        tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await
    {
        if let CommandEvent::Stderr(bytes) = event {
            let line = String::from_utf8_lossy(&bytes);
            let trimmed = line.trim_end_matches(['\n', '\r']);
            if !trimmed.is_empty() {
                eprintln!("[pipeline-worker] {trimmed}");
            }
        }
    }

    if let Some(tx) = init_done_tx.take() {
        let _ = tx.send(Err("worker exited before init response".to_string()));
    }
    if let Some(tx) = run_done_tx.take() {
        let _ = tx.send(Err("worker exited before run completed".to_string()));
    }

    app.state::<PipelineBridgeState>().revoke(&bridge_token);
    // Completed imports are fully synced to main; drop the per-import db (Update rebuilds it on demand).
    if cancelled || book_import_completed(&app, &book_import_id).await {
        delete_import_db(&app, &book_import_id);
    }
    finalize_worker(&app, &book_import_id);
}

async fn book_import_completed(app: &AppHandle, book_import_id: &str) -> bool {
    use sqlx::sqlite::SqliteConnectOptions;
    use sqlx::{ConnectOptions, Connection};
    use std::str::FromStr;
    use std::time::Duration;

    let Ok(main_path) = main_db_path(app) else {
        return false;
    };
    let Ok(opts) = SqliteConnectOptions::from_str(&main_path.to_string_lossy()) else {
        return false;
    };
    let Ok(mut conn) = opts
        .create_if_missing(false)
        .read_only(true)
        .busy_timeout(Duration::from_secs(5))
        .connect()
        .await
    else {
        return false;
    };
    let status: Option<(String,)> = sqlx::query_as("SELECT status FROM book_imports WHERE id = ?1")
        .bind(book_import_id)
        .fetch_optional(&mut conn)
        .await
        .ok()
        .flatten();
    let _ = conn.close().await;
    matches!(status, Some((s,)) if s == "completed")
}

async fn read_provider_env_var_names(db_path: &str) -> Result<Vec<String>, String> {
    use sqlx::sqlite::SqliteConnectOptions;
    use sqlx::{ConnectOptions, Connection};
    use std::str::FromStr;

    if !std::path::Path::new(db_path).exists() {
        return Ok(Vec::new());
    }

    let mut conn = SqliteConnectOptions::from_str(db_path)
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|e| format!("sqlite connect: {e}"))?;

    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT secret_env_var FROM providers \
         WHERE secret_priority = 'env' \
           AND secret_env_var IS NOT NULL \
           AND secret_env_var <> ''",
    )
    .fetch_all(&mut conn)
    .await
    .map_err(|e| format!("sqlite query: {e}"))?;

    let _ = conn.close().await;

    Ok(rows
        .into_iter()
        .filter_map(|(name,)| {
            if is_valid_env_var_name(&name) {
                Some(name)
            } else {
                eprintln!("[pipeline-worker] ignoring invalid secret_env_var: {name:?}");
                None
            }
        })
        .collect())
}

fn is_valid_env_var_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn error_message(error: &Value) -> String {
    error
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error")
        .to_string()
}

fn finalize_worker(app: &AppHandle, book_import_id: &str) {
    let state = app.state::<PipelineWorkerState>();
    if let Ok(mut map) = state.children.lock() {
        map.remove(book_import_id);
    }

    if state.children.lock().map(|m| m.is_empty()).unwrap_or(false) {
        let keepawake = app.state::<KeepawakeState>();
        let _ = allow_sleep(keepawake);
    }

    let _ = app.emit("query:invalidate", book_import_id);
}

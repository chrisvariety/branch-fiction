use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::{mpsc, oneshot};

use crate::extension_db::{extension_assets_dir, prepare_extension_db};
use crate::http_server::HttpPortState;

const INIT_REQUEST_ID: u64 = 1;
const RUN_TASK_REQUEST_ID: u64 = 2;

#[derive(Default)]
pub struct ExtensionRuntimeState {
    pub(crate) tasks: Mutex<HashMap<String, oneshot::Sender<()>>>,
    /// Single-flight claims for singleton tasks: claim key -> owning task id.
    pub(crate) singletons: Mutex<HashMap<String, String>>,
}

#[derive(Deserialize, Clone)]
pub struct StartExtensionTaskArgs {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "extensionId")]
    extension_id: String,
    #[serde(rename = "bookId")]
    book_id: Option<String>,
    #[serde(rename = "extensionInstallDir")]
    extension_install_dir: String,
    #[serde(rename = "extensionWorkerPath")]
    extension_worker_path: String,
    task: String,
    #[serde(default)]
    payload: Option<Value>,
    #[serde(default)]
    providers: Value,
    #[serde(default)]
    config: Value,
    #[serde(default)]
    net_allowlist: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct RunExtensionTaskRequest {
    pub extension_id: String,
    pub book_id: Option<String>,
    pub extension_install_dir: String,
    pub extension_worker_path: String,
    pub task: String,
    pub payload: Option<Value>,
    pub providers: Value,
    pub config: Value,
    pub net_allowlist: Vec<String>,
}

#[derive(Debug)]
pub enum ExtensionTaskEvent {
    Log(Value),
    Result(Value),
    Error(String),
}

fn is_valid_net_entry(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let (host, port) = match s.split_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (s, None),
    };
    // Permit a single leading-label wildcard (*.example.com); Deno --allow-net supports it.
    let host_body = host.strip_prefix("*.").unwrap_or(host);
    if host_body.is_empty()
        || host_body.contains('*')
        || !host_body
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    {
        return false;
    }
    if let Some(p) = port
        && (p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return false;
    }
    true
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_extension_task(
    app: AppHandle,
    state: State<'_, ExtensionRuntimeState>,
    args: StartExtensionTaskArgs,
) -> Result<Value, String> {
    {
        let map = state.tasks.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&args.task_id) {
            return Err(format!("extension task already running: {}", args.task_id));
        }
    }

    let task_id = args.task_id.clone();
    let req = RunExtensionTaskRequest {
        extension_id: args.extension_id,
        book_id: args.book_id,
        extension_install_dir: args.extension_install_dir,
        extension_worker_path: args.extension_worker_path,
        task: args.task,
        payload: args.payload,
        providers: args.providers,
        config: args.config,
        net_allowlist: args.net_allowlist,
    };

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let (event_tx, mut event_rx) = mpsc::channel::<ExtensionTaskEvent>(64);

    {
        let mut map = state.tasks.lock().map_err(|e| e.to_string())?;
        map.insert(task_id.clone(), cancel_tx);
    }

    let app_for_run = app.clone();
    let runner = tauri::async_runtime::spawn(async move {
        run_extension_task_internal(app_for_run, req, event_tx, cancel_rx).await;
    });

    let mut outcome: Result<Value, String> =
        Err("extension worker exited without returning a result".to_string());
    while let Some(event) = event_rx.recv().await {
        match event {
            ExtensionTaskEvent::Log(args) => {
                let _ = app.emit(
                    "extension-task:log",
                    json!({ "taskId": task_id, "args": args }),
                );
            }
            ExtensionTaskEvent::Result(v) => {
                outcome = Ok(v);
                break;
            }
            ExtensionTaskEvent::Error(e) => {
                outcome = Err(e);
                break;
            }
        }
    }

    let _ = runner.await;

    {
        let mut map = state.tasks.lock().map_err(|e| e.to_string())?;
        map.remove(&task_id);
    }

    outcome
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_extension_task(
    state: State<'_, ExtensionRuntimeState>,
    task_id: String,
) -> Result<(), String> {
    let kill_tx = {
        let mut map = state.tasks.lock().map_err(|e| e.to_string())?;
        map.remove(&task_id)
    };
    if let Some(tx) = kill_tx {
        let _ = tx.send(());
    }
    Ok(())
}

/// Cancel a task by id from an `AppHandle` (no State extractor needed).
pub fn cancel_task_by_id(app: &AppHandle, task_id: &str) {
    let state = app.state::<ExtensionRuntimeState>();
    let kill_tx = match state.tasks.lock() {
        Ok(mut map) => map.remove(task_id),
        Err(_) => return,
    };
    if let Some(tx) = kill_tx {
        let _ = tx.send(());
    }
}

/// Register a task cancel sender; returns false if the id already exists.
pub fn register_task(app: &AppHandle, task_id: &str, cancel_tx: oneshot::Sender<()>) -> bool {
    let state = app.state::<ExtensionRuntimeState>();
    let mut map = match state.tasks.lock() {
        Ok(m) => m,
        Err(_) => return false,
    };
    if map.contains_key(task_id) {
        return false;
    }
    map.insert(task_id.to_string(), cancel_tx);
    true
}

/// Claim a singleton key for a task; returns false if another task holds it.
pub fn claim_singleton(app: &AppHandle, key: &str, task_id: &str) -> bool {
    let state = app.state::<ExtensionRuntimeState>();
    let mut map = match state.singletons.lock() {
        Ok(m) => m,
        Err(_) => return false,
    };
    if map.contains_key(key) {
        return false;
    }
    map.insert(key.to_string(), task_id.to_string());
    true
}

/// Release any singleton claims held by a task.
pub fn release_singletons_for_task(app: &AppHandle, task_id: &str) {
    let state = app.state::<ExtensionRuntimeState>();
    if let Ok(mut map) = state.singletons.lock() {
        map.retain(|_, owner| owner != task_id);
    }
}

pub fn unregister_task(app: &AppHandle, task_id: &str) {
    let state = app.state::<ExtensionRuntimeState>();
    if let Ok(mut map) = state.tasks.lock() {
        map.remove(task_id);
    }
    release_singletons_for_task(app, task_id);
}

/// Run an extension worker, streaming events into `event_tx` until the worker exits.
pub async fn run_extension_task_internal(
    app: AppHandle,
    req: RunExtensionTaskRequest,
    event_tx: mpsc::Sender<ExtensionTaskEvent>,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    let db_path = match prepare_extension_db(&app, &req.extension_id).await {
        Ok(p) => p,
        Err(e) => {
            let _ = event_tx.send(ExtensionTaskEvent::Error(e)).await;
            return;
        }
    };
    let data_dir = match extension_assets_dir(&app, &req.extension_id) {
        Ok(p) => p,
        Err(e) => {
            let _ = event_tx.send(ExtensionTaskEvent::Error(e)).await;
            return;
        }
    };
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        let _ = event_tx
            .send(ExtensionTaskEvent::Error(format!("mkdir assets: {e}")))
            .await;
        return;
    }

    let bundle_path = match app.path().resolve(
        "resources/extension-host.bundle.js",
        BaseDirectory::Resource,
    ) {
        Ok(p) => p,
        Err(e) => {
            let _ = event_tx
                .send(ExtensionTaskEvent::Error(format!(
                    "resolve extension-host bundle: {e}"
                )))
                .await;
            return;
        }
    };

    let extension_data_dir = match db_path.parent() {
        Some(p) => p.to_path_buf(),
        None => {
            let _ = event_tx
                .send(ExtensionTaskEvent::Error(
                    "extension db path has no parent".to_string(),
                ))
                .await;
            return;
        }
    };

    let models_catalog_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("storage").join("models-catalog.json"))
        .map(|p| p.to_string_lossy().to_string());

    let mut allow_read = format!(
        "{},{},{}",
        extension_data_dir.to_string_lossy(),
        req.extension_install_dir,
        bundle_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    );
    if let Some(catalog_path) = &models_catalog_path {
        allow_read.push(',');
        allow_read.push_str(catalog_path);
    }
    let allow_write = extension_data_dir.to_string_lossy().to_string();

    let http_port = app.state::<HttpPortState>().0;
    let mut allow_net_entries = vec![
        format!("127.0.0.1:{http_port}"),
        format!("localhost:{http_port}"),
    ];
    for entry in &req.net_allowlist {
        let trimmed = entry.trim();
        if !is_valid_net_entry(trimmed) {
            let _ = event_tx
                .send(ExtensionTaskEvent::Error(format!(
                    "invalid net allowlist entry: {entry:?} (expected host or host:port)"
                )))
                .await;
            return;
        }
        let owned = trimmed.to_string();
        if !allow_net_entries.contains(&owned) {
            allow_net_entries.push(owned);
        }
    }
    let allow_net = allow_net_entries.join(",");

    let deno_args = vec![
        "run".to_string(),
        "--no-config".to_string(),
        format!("--allow-read={allow_read}"),
        format!("--allow-write={allow_write}"),
        format!("--allow-net={allow_net}"),
        bundle_path.to_string_lossy().to_string(),
    ];

    let sidecar = match app.shell().sidecar("deno") {
        Ok(s) => s,
        Err(e) => {
            let _ = event_tx
                .send(ExtensionTaskEvent::Error(format!("sidecar lookup: {e}")))
                .await;
            return;
        }
    };
    let (rx, child) = match sidecar.args(deno_args).spawn() {
        Ok(p) => p,
        Err(e) => {
            let _ = event_tx
                .send(ExtensionTaskEvent::Error(format!("sidecar spawn: {e}")))
                .await;
            return;
        }
    };

    let extension_id = req.extension_id.clone();
    let db_path_str = db_path.to_string_lossy().to_string();
    let data_dir_str = data_dir.to_string_lossy().to_string();

    pump_worker(
        extension_id,
        req.book_id,
        req.providers,
        req.config,
        db_path_str,
        data_dir_str,
        models_catalog_path,
        req.extension_worker_path,
        req.task,
        req.payload,
        child,
        rx,
        event_tx,
        &mut cancel_rx,
    )
    .await;
}

#[allow(clippy::too_many_arguments)]
async fn pump_worker(
    extension_id: String,
    book_id: Option<String>,
    providers: Value,
    config: Value,
    db_path: String,
    data_dir: String,
    models_catalog_path: Option<String>,
    extension_worker_path: String,
    task_name: String,
    payload: Option<Value>,
    mut child: CommandChild,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    event_tx: mpsc::Sender<ExtensionTaskEvent>,
    cancel_rx: &mut oneshot::Receiver<()>,
) {
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": INIT_REQUEST_ID,
        "method": "init",
        "params": [{
            "extensionId": extension_id,
            "bookId": book_id,
            "providers": providers,
            "config": config,
            "dbPath": db_path,
            "dataDir": data_dir,
            "modelsCatalogPath": models_catalog_path,
            "extensionWorkerPath": extension_worker_path,
        }]
    });

    if let Err(e) = child.write(format!("{init_req}\n").as_bytes()) {
        let _ = event_tx
            .send(ExtensionTaskEvent::Error(format!(
                "failed to write init: {e}"
            )))
            .await;
        let _ = child.kill();
        return;
    }

    let mut terminal_sent = false;
    let mut init_complete = false;

    loop {
        tokio::select! {
            biased;

            _ = &mut *cancel_rx => {
                eprintln!("[extension-host] cancelled");
                let _ = child.kill();
                if !terminal_sent {
                    let _ = event_tx
                        .send(ExtensionTaskEvent::Error("extension task cancelled".to_string()))
                        .await;
                    terminal_sent = true;
                }
                break;
            }

            event = rx.recv() => {
                let Some(event) = event else { break };
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        let trimmed = line.trim();
                        if trimmed.is_empty() { continue; }
                        let Ok(msg) = serde_json::from_str::<Value>(trimmed) else {
                            eprintln!("[extension-host stray-stdout] {trimmed}");
                            continue;
                        };

                        let id = msg.get("id").and_then(|v| v.as_u64());
                        if id.is_none() {
                            // Notification, e.g. host.log
                            forward_notification(&msg, &event_tx).await;
                            continue;
                        }

                        let error = msg.get("error");
                        let result = msg.get("result");
                        match id {
                            Some(INIT_REQUEST_ID) => {
                                if let Some(err) = error {
                                    let _ = child.kill();
                                    if !terminal_sent {
                                        let _ = event_tx
                                            .send(ExtensionTaskEvent::Error(format!(
                                                "init failed: {}",
                                                error_message(err)
                                            )))
                                            .await;
                                        terminal_sent = true;
                                    }
                                    break;
                                }
                                init_complete = true;
                                let run_req = json!({
                                    "jsonrpc": "2.0",
                                    "id": RUN_TASK_REQUEST_ID,
                                    "method": "runTask",
                                    "params": [{
                                        "task": task_name,
                                        "payload": payload,
                                    }]
                                });
                                if let Err(e) = child.write(format!("{run_req}\n").as_bytes()) {
                                    let _ = child.kill();
                                    if !terminal_sent {
                                        let _ = event_tx
                                            .send(ExtensionTaskEvent::Error(format!(
                                                "failed to write runTask: {e}"
                                            )))
                                            .await;
                                        terminal_sent = true;
                                    }
                                    break;
                                }
                            }
                            Some(RUN_TASK_REQUEST_ID) => {
                                if !terminal_sent {
                                    if let Some(err) = error {
                                        let _ = event_tx
                                            .send(ExtensionTaskEvent::Error(error_message(err)))
                                            .await;
                                    } else {
                                        let value = result
                                            .and_then(|r| r.get("result"))
                                            .cloned()
                                            .unwrap_or(Value::Null);
                                        let _ = event_tx.send(ExtensionTaskEvent::Result(value)).await;
                                    }
                                    terminal_sent = true;
                                }
                                let _ = child.kill();
                                break;
                            }
                            _ => {
                                eprintln!("[extension-host stray-stdout] {trimmed}");
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        let trimmed = line.trim_end_matches(['\n', '\r']);
                        if !trimmed.is_empty() {
                            eprintln!("[extension-host:{extension_id}] {trimmed}");
                        }
                    }
                    CommandEvent::Error(e) => {
                        eprintln!("[extension-host] command error: {e}");
                    }
                    CommandEvent::Terminated(payload) => {
                        eprintln!(
                            "[extension-host] exited code={:?} signal={:?}",
                            payload.code, payload.signal
                        );
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    if !terminal_sent {
        let msg = if init_complete {
            "extension worker exited without returning a result".to_string()
        } else {
            "extension worker exited before init response".to_string()
        };
        let _ = event_tx.send(ExtensionTaskEvent::Error(msg)).await;
    }
}

async fn forward_notification(msg: &Value, event_tx: &mpsc::Sender<ExtensionTaskEvent>) {
    let Some(method) = msg.get("method").and_then(|v| v.as_str()) else {
        return;
    };
    if method == "host.log" {
        let args = msg
            .get("params")
            .and_then(|p| p.get("args"))
            .cloned()
            .unwrap_or(Value::Array(Vec::new()));
        let _ = event_tx.send(ExtensionTaskEvent::Log(args)).await;
    }
}

fn error_message(error: &Value) -> String {
    error
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error")
        .to_string()
}

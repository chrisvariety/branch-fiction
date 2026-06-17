use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{HeaderMap, Method, StatusCode, Uri},
};
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

use crate::http_server::HttpPortState;
use crate::provider_catalog::{base_url_for_type, provider_catalog};
use crate::provider_proxy::{AuthShape, ResolvedProvider, forward_to_provider};

const TOKEN_PREFIX: &str = "tps_";
const SESSION_TTL: Duration = Duration::from_secs(90);
const DENO_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct TestSession {
    base_url: String,
    auth: AuthShape,
    secret: Option<String>,
    created_at: Instant,
}

#[derive(Clone, Default)]
pub struct TestProviderState {
    sessions: Arc<Mutex<HashMap<String, TestSession>>>,
}

impl TestProviderState {
    fn mint(&self, session: TestSession) -> String {
        let token = format!("{TOKEN_PREFIX}{}", Uuid::new_v4().simple());
        let mut map = self.sessions.lock().expect("test provider lock poisoned");
        map.insert(token.clone(), session);
        token
    }

    fn revoke(&self, token: &str) {
        let mut map = self.sessions.lock().expect("test provider lock poisoned");
        map.remove(token);
    }

    fn lookup(&self, token: &str) -> Option<TestSession> {
        let mut map = self.sessions.lock().expect("test provider lock poisoned");
        let session = map.get(token).cloned()?;
        if session.created_at.elapsed() > SESSION_TTL {
            map.remove(token);
            return None;
        }
        Some(session)
    }
}

pub async fn test_provider_proxy_handler(
    State(app): State<AppHandle>,
    AxumPath((token, rest)): AxumPath<(String, String)>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let session = app.state::<TestProviderState>().lookup(&token).ok_or((
        StatusCode::UNAUTHORIZED,
        "unknown or expired test-provider token".to_string(),
    ))?;

    let resolved = ResolvedProvider {
        base_url: session.base_url,
        auth: session.auth,
        secret: session.secret,
        rpm_limit: None,
    };
    forward_to_provider(
        "test-provider",
        false,
        resolved,
        &rest,
        method,
        uri.query(),
        headers,
        body,
    )
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderParams {
    pub provider_type: String,
    pub api_key: Option<String>,
    pub api_key_env_var: Option<String>,
    pub base_url: Option<String>,
    pub model_id: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum TestProviderResult {
    Ok { ok: bool },
    Err { ok: bool, error: String },
}

fn ok() -> TestProviderResult {
    TestProviderResult::Ok { ok: true }
}

fn err(message: impl Into<String>) -> TestProviderResult {
    TestProviderResult::Err {
        ok: false,
        error: message.into(),
    }
}

fn resolve_key(params: &TestProviderParams) -> Option<String> {
    if let Some(k) = params.api_key.as_ref().filter(|s| !s.is_empty()) {
        return Some(k.clone());
    }
    if let Some(name) = params.api_key_env_var.as_ref().filter(|s| !s.is_empty())
        && let Ok(v) = std::env::var(name)
        && !v.is_empty()
    {
        return Some(v);
    }
    None
}

fn resolve_auth_shape(provider_type: &str) -> Option<AuthShape> {
    provider_catalog()
        .into_iter()
        .find(|e| e.provider_type == provider_type)
        .map(|e| e.auth)
}

fn resolve_base_url(params: &TestProviderParams) -> Option<String> {
    if let Some(b) = params
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(b.to_string());
    }
    base_url_for_type(&params.provider_type).map(str::to_string)
}

#[tauri::command]
pub async fn test_provider_config(
    app: AppHandle,
    params: TestProviderParams,
) -> TestProviderResult {
    if params.model_id.is_empty() {
        return err("Missing model ID");
    }
    let Some(auth) = resolve_auth_shape(&params.provider_type) else {
        return err(format!(
            "Unsupported provider type \"{}\"",
            params.provider_type
        ));
    };
    let Some(base_url) = resolve_base_url(&params) else {
        return err("Base URL is required");
    };

    let secret = resolve_key(&params);
    let needs_key = !matches!(auth, AuthShape::None);
    if needs_key && secret.is_none() {
        return err("Missing API key");
    }

    match run_session(&app, &params, base_url, auth, secret).await {
        Ok(()) => ok(),
        Err(e) => err(e),
    }
}

async fn run_session(
    app: &AppHandle,
    params: &TestProviderParams,
    base_url: String,
    auth: AuthShape,
    secret: Option<String>,
) -> Result<(), String> {
    let state = app.state::<TestProviderState>();
    let token = state.mint(TestSession {
        base_url,
        auth,
        secret,
        created_at: Instant::now(),
    });

    let result = spawn_and_run(app, params, &token).await;
    state.revoke(&token);
    result
}

async fn spawn_and_run(
    app: &AppHandle,
    params: &TestProviderParams,
    token: &str,
) -> Result<(), String> {
    let bundle_path = app
        .path()
        .resolve("resources/test-provider.bundle.js", BaseDirectory::Resource)
        .map_err(|e| format!("resolve bundle: {e}"))?;
    let bundle_str = bundle_path.to_string_lossy().to_string();
    let bundle_dir = bundle_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let port = app.state::<HttpPortState>().0;
    let allow_net = format!("127.0.0.1:{port},localhost:{port}");
    let proxy_base_url = format!("http://127.0.0.1:{port}/test-provider/{token}");

    let models_catalog_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("storage").join("models-catalog.json"))
        .map(|p| p.to_string_lossy().to_string());

    let mut allow_read = bundle_dir;
    if let Some(catalog_path) = &models_catalog_path {
        allow_read.push(',');
        allow_read.push_str(catalog_path);
    }

    let args = vec![
        "run".to_string(),
        "--no-config".to_string(),
        format!("--allow-read={allow_read}"),
        format!("--allow-net={allow_net}"),
        bundle_str,
    ];

    let (mut rx, mut child) = app
        .shell()
        .sidecar("deno")
        .map_err(|e| format!("sidecar lookup: {e}"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("sidecar spawn: {e}"))?;

    let payload = serde_json::json!({
        "providerType": params.provider_type,
        "modelId": params.model_id,
        "proxyBaseUrl": proxy_base_url,
        "modelsCatalogPath": models_catalog_path,
    });
    // tauri-plugin-shell has no close-stdin API, so the worker reads a single
    // newline-terminated line rather than waiting for EOF.
    let payload_bytes = format!("{payload}\n").into_bytes();
    if let Err(e) = child.write(&payload_bytes) {
        let _ = child.kill();
        return Err(format!("write stdin: {e}"));
    }

    let deadline = tokio::time::Instant::now() + DENO_TIMEOUT;
    let mut stdout = String::new();
    let mut stderr_buf = String::new();

    loop {
        let event = match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Some(event)) => event,
            Ok(None) => break,
            Err(_) => {
                let _ = child.kill();
                return Err(format!(
                    "test-provider timed out after {}s",
                    DENO_TIMEOUT.as_secs()
                ));
            }
        };
        match event {
            CommandEvent::Stdout(bytes) => {
                stdout.push_str(&String::from_utf8_lossy(&bytes));
                if stdout.contains('\n') {
                    break;
                }
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                let trimmed = line.trim_end_matches(['\n', '\r']);
                if !trimmed.is_empty() {
                    eprintln!("[test-provider] {trimmed}");
                    stderr_buf.push_str(trimmed);
                    stderr_buf.push('\n');
                }
            }
            CommandEvent::Error(e) => {
                let _ = child.kill();
                return Err(format!("sidecar error: {e}"));
            }
            CommandEvent::Terminated(payload) => {
                eprintln!(
                    "[test-provider] exited code={:?} signal={:?}",
                    payload.code, payload.signal
                );
                break;
            }
            _ => {}
        }
    }

    let _ = child.kill();

    let line = stdout.lines().next().unwrap_or("").trim().to_string();
    if line.is_empty() {
        let tail = stderr_buf.trim().to_string();
        if tail.is_empty() {
            return Err("test-provider produced no output".to_string());
        }
        return Err(format!("test-provider produced no output (stderr: {tail})"));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&line).map_err(|e| format!("invalid sidecar output: {e}: {line}"))?;
    let is_ok = parsed.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if is_ok {
        return Ok(());
    }
    let error = parsed
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error")
        .to_string();
    Err(error)
}

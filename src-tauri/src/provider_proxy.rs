use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};

const MAX_RETRIES: u32 = 5;
const TOTAL_RETRY_BUDGET: Duration = Duration::from_secs(360);
// Default retry delay when Retry-After is absent; short retries usually just bounce on RPM gates.
const DEFAULT_RETRY_DELAY: Duration = Duration::from_secs(60);

#[derive(Deserialize, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthShape {
    None,
    Bearer {
        #[serde(
            default,
            rename = "headerPrefix",
            skip_serializing_if = "Option::is_none"
        )]
        header_prefix: Option<String>,
    },
    Header {
        header: String,
    },
    QueryParam {
        param: String,
    },
    Body {
        field: String,
    },
}

// 32 MiB body buffer ceiling; always buffered so 429s can be retried with Retry-After honored.
const MAX_BUFFERED_BODY_BYTES: usize = 32 * 1024 * 1024;

pub struct ResolvedProvider {
    pub base_url: String,
    pub auth: AuthShape,
    pub secret: Option<String>,
    pub rpm_limit: Option<u32>,
}

// Sliding 60s window rate limiter keyed by base_url; waiters park until oldest send ages out.
const WINDOW: Duration = Duration::from_secs(60);

struct SlidingWindow {
    rpm: u32,
    sends: VecDeque<Instant>,
}

impl SlidingWindow {
    fn new(rpm: u32) -> Self {
        Self {
            rpm: rpm.max(1),
            sends: VecDeque::new(),
        }
    }

    fn acquire(&mut self, rpm: u32) -> AcquireOutcome {
        self.rpm = rpm.max(1);
        let capacity = self.rpm as usize;
        let now = Instant::now();
        let cutoff = now.checked_sub(WINDOW).unwrap_or(now);
        while let Some(&front) = self.sends.front() {
            if front < cutoff {
                self.sends.pop_front();
            } else {
                break;
            }
        }
        let (wait, send_at) = if self.sends.len() < capacity {
            (Duration::ZERO, now)
        } else {
            let oldest = *self.sends.front().expect("full window had no front");
            self.sends.pop_front();
            let send_at = oldest + WINDOW;
            (send_at.saturating_duration_since(now), send_at)
        };
        self.sends.push_back(send_at);
        AcquireOutcome {
            wait,
            in_window_after: self.sends.len(),
            capacity: self.rpm,
        }
    }

    fn snapshot(&self) -> (usize, u32) {
        (self.sends.len(), self.rpm)
    }
}

struct AcquireOutcome {
    wait: Duration,
    in_window_after: usize,
    capacity: u32,
}

static RATE_LIMITERS: OnceLock<Mutex<HashMap<String, Arc<Mutex<SlidingWindow>>>>> = OnceLock::new();

fn rate_limiter(base_url: &str, rpm: u32) -> Arc<Mutex<SlidingWindow>> {
    let map = RATE_LIMITERS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = map.lock().expect("rate limiter map poisoned");
    map.entry(base_url.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(SlidingWindow::new(rpm))))
        .clone()
}

pub fn build_target_url(base_url: &str, rest: &str, query: Option<&str>) -> Result<Url, String> {
    let trimmed_base = base_url.trim_end_matches('/');
    let trimmed_rest = rest.trim_start_matches('/');
    let mut joined = if trimmed_rest.is_empty() {
        trimmed_base.to_string()
    } else {
        format!("{trimmed_base}/{trimmed_rest}")
    };
    if let Some(q) = query
        && !q.is_empty()
    {
        joined.push('?');
        joined.push_str(q);
    }
    Url::parse(&joined).map_err(|e| format!("bad target url {joined:?}: {e}"))
}

pub fn sanitize_headers(incoming: HeaderMap, auth: &AuthShape) -> HeaderMap {
    let auth_headers = crate::provider_catalog::known_auth_header_names();
    let mut out = HeaderMap::new();
    for (name, value) in incoming.iter() {
        let n = name.as_str().to_ascii_lowercase();
        if matches!(n.as_str(), "host" | "content-length" | "connection") {
            continue;
        }
        if auth_headers.contains(&n) {
            continue;
        }
        if let AuthShape::Header { header } = auth
            && n == header.to_ascii_lowercase()
        {
            continue;
        }
        out.append(name, value.clone());
    }
    out
}

pub fn apply_auth(
    auth: &AuthShape,
    api_key: &str,
    headers: &mut HeaderMap,
    url: &mut Url,
) -> Result<(), String> {
    match auth {
        AuthShape::None => Ok(()),
        AuthShape::Bearer { header_prefix } => {
            let prefix = header_prefix.as_deref().unwrap_or("Bearer");
            let v = HeaderValue::from_str(&format!("{prefix} {api_key}"))
                .map_err(|e| format!("bearer header: {e}"))?;
            headers.insert(HeaderName::from_static("authorization"), v);
            Ok(())
        }
        AuthShape::Header { header } => {
            let name = HeaderName::from_bytes(header.as_bytes())
                .map_err(|e| format!("bad auth header name {header:?}: {e}"))?;
            let v = HeaderValue::from_str(api_key)
                .map_err(|e| format!("bad auth header value: {e}"))?;
            headers.insert(name, v);
            Ok(())
        }
        AuthShape::QueryParam { param } => {
            let existing: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(k, _)| k != param)
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
            url.query_pairs_mut().clear();
            for (k, v) in existing {
                url.query_pairs_mut().append_pair(&k, &v);
            }
            url.query_pairs_mut().append_pair(param, api_key);
            Ok(())
        }
        AuthShape::Body { .. } => {
            // Body rewriting happens after the request body is buffered.
            Ok(())
        }
    }
}

fn rewrite_body_with_auth(field: &str, api_key: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("invalid json: {e}"))?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| "JSON root must be an object".to_string())?;
    obj.insert(
        field.to_string(),
        serde_json::Value::String(api_key.to_string()),
    );
    serde_json::to_vec(&value).map_err(|e| format!("serialize: {e}"))
}

// Disable Gemini's default safety thresholds so fiction prompts aren't silently refused
// & leaves any existing safetySettings untouched, if specified.
fn inject_gemini_safety_settings(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("invalid json: {e}"))?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| "JSON root must be an object".to_string())?;
    if obj.contains_key("safetySettings") {
        return Ok(bytes.to_vec());
    }
    let categories = [
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
        "HARM_CATEGORY_CIVIC_INTEGRITY",
    ];
    let settings: Vec<serde_json::Value> = categories
        .iter()
        .map(|category| serde_json::json!({ "category": category, "threshold": "BLOCK_NONE" }))
        .collect();
    obj.insert(
        "safetySettings".to_string(),
        serde_json::Value::Array(settings),
    );
    serde_json::to_vec(&value).map_err(|e| format!("serialize: {e}"))
}

fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let val = headers.get(reqwest::header::RETRY_AFTER)?;
    let s = val.to_str().ok()?.trim();
    if let Ok(secs) = s.parse::<u64>() {
        return Some(Duration::from_secs(secs));
    }
    if let Ok(secs_f) = s.parse::<f64>()
        && secs_f.is_finite()
        && secs_f >= 0.0
    {
        return Some(Duration::from_secs_f64(secs_f));
    }
    None
}

fn retry_delay(retry_after: Option<Duration>) -> Duration {
    retry_after.unwrap_or(DEFAULT_RETRY_DELAY)
}

pub async fn forward_to_provider(
    label: &str,
    resolved: ResolvedProvider,
    rest: &str,
    method: Method,
    query: Option<&str>,
    headers: HeaderMap,
    body: Body,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let mut target = build_target_url(&resolved.base_url, rest, query)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;

    let mut outbound = sanitize_headers(headers, &resolved.auth);

    if let Some(ref secret) = resolved.secret {
        apply_auth(&resolved.auth, secret, &mut outbound, &mut target)
            .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
    }

    let client = Client::new();

    let body_bytes: Option<Bytes> = if matches!(method, Method::GET | Method::HEAD) {
        if let AuthShape::Body { .. } = resolved.auth {
            return Err((
                StatusCode::BAD_REQUEST,
                "body auth requires a JSON request body".to_string(),
            ));
        }
        None
    } else {
        let raw = axum::body::to_bytes(body, MAX_BUFFERED_BODY_BYTES)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("read body: {e}")))?;
        if let AuthShape::Body { ref field } = resolved.auth {
            if raw.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "body auth requires a JSON request body".to_string(),
                ));
            }
            let content_type = outbound
                .get(axum::http::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if !content_type.is_empty()
                && !content_type
                    .to_ascii_lowercase()
                    .starts_with("application/json")
            {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "body auth requires application/json content-type".to_string(),
                ));
            }
            let api_key = resolved.secret.as_deref().unwrap_or("");
            let rewritten = rewrite_body_with_auth(field, api_key, &raw)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("body auth: {e}")))?;
            outbound.insert(
                axum::http::header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
            Some(Bytes::from(rewritten))
        } else {
            Some(raw)
        }
    };

    let body_bytes = match body_bytes {
        Some(bytes) if target.path().contains("generateContent") => {
            match inject_gemini_safety_settings(&bytes) {
                Ok(rewritten) => Some(Bytes::from(rewritten)),
                Err(e) => {
                    eprintln!("[proxy] {label} safety-settings inject skipped: {e}");
                    Some(bytes)
                }
            }
        }
        other => other,
    };

    let retry_started = Instant::now();
    let mut attempt: u32 = 0;
    let upstream = loop {
        if let Some(rpm) = resolved.rpm_limit {
            let limiter = rate_limiter(&resolved.base_url, rpm);
            let outcome = limiter.lock().expect("rate limiter poisoned").acquire(rpm);
            if !outcome.wait.is_zero() {
                let wait = Duration::from_secs(outcome.wait.as_secs_f64().ceil() as u64);
                eprintln!(
                    "[proxy] {label} rate-limit hit ({}/{} in last 60s), waiting {}s",
                    outcome.in_window_after,
                    outcome.capacity,
                    wait.as_secs()
                );
                tokio::time::sleep(wait).await;
            }
        }

        let mut req = client
            .request(method.clone(), target.clone())
            .headers(outbound.clone());
        if let Some(ref b) = body_bytes {
            req = req.body(b.clone());
        }

        let upstream = req.send().await.map_err(|e| {
            eprintln!("[proxy] {label} {method} {target} -> send error: {e}");
            (StatusCode::BAD_GATEWAY, format!("upstream send: {e}"))
        })?;

        if upstream.status() != StatusCode::TOO_MANY_REQUESTS || attempt >= MAX_RETRIES {
            break upstream;
        }

        let bucket_state = resolved
            .rpm_limit
            .map(|rpm| {
                let limiter = rate_limiter(&resolved.base_url, rpm);
                let (used, capacity) = limiter.lock().expect("rate limiter poisoned").snapshot();
                format!(" window={used}/{capacity}")
            })
            .unwrap_or_default();

        let retry_after = parse_retry_after(upstream.headers());
        let delay = retry_delay(retry_after);
        let elapsed = retry_started.elapsed();
        if elapsed + delay > TOTAL_RETRY_BUDGET {
            eprintln!(
                "[proxy] {label} {method} {target} -> 429; retry budget exhausted (elapsed {:.1}s, next delay {:.1}s){bucket_state}",
                elapsed.as_secs_f64(),
                delay.as_secs_f64()
            );
            break upstream;
        }

        attempt += 1;
        let hint = retry_after
            .map(|d| format!(" (Retry-After: {:.1}s)", d.as_secs_f64()))
            .unwrap_or_default();
        eprintln!(
            "[proxy] {label} {method} {target} -> 429; retrying in {:.1}s (attempt {}/{}){}{bucket_state}",
            delay.as_secs_f64(),
            attempt,
            MAX_RETRIES,
            hint
        );

        drop(upstream);
        tokio::time::sleep(delay).await;
    };

    let status = upstream.status();
    eprintln!("[proxy] {label} {method} {target} -> {}", status.as_u16());
    let mut response_headers = upstream.headers().clone();
    response_headers.remove("content-length");
    response_headers.remove("content-encoding");
    response_headers.remove("transfer-encoding");

    let stream = upstream.bytes_stream();
    let body = Body::from_stream(stream);

    let mut resp = axum::response::Response::new(body);
    *resp.status_mut() = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    *resp.headers_mut() = response_headers;
    Ok(resp)
}

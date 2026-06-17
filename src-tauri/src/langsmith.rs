// Flat per-request Langsmith logging for proxied LLM calls, gated on LANGSMITH_API_KEY.

use std::sync::OnceLock;
use std::time::SystemTime;

use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::{Stream, StreamExt};
use reqwest::Client;
use serde_json::{Value, json};
use uuid::Uuid;

struct Config {
    api_key: String,
    endpoint: String,
    project: Option<String>,
}

fn config() -> Option<&'static Config> {
    static CFG: OnceLock<Option<Config>> = OnceLock::new();
    CFG.get_or_init(|| {
        let api_key = std::env::var("LANGSMITH_API_KEY")
            .ok()
            .filter(|s| !s.is_empty())?;
        let endpoint = std::env::var("LANGSMITH_ENDPOINT")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://api.smith.langchain.com".to_string());
        let project = std::env::var("LANGSMITH_PROJECT")
            .ok()
            .filter(|s| !s.is_empty());
        Some(Config {
            api_key,
            endpoint: endpoint.trim_end_matches('/').to_string(),
            project,
        })
    })
    .as_ref()
}

pub fn is_enabled() -> bool {
    config().is_some()
}

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(Client::new)
}

// The LLM wire formats we know how to parse; anything else is left unlogged.
#[derive(Clone, Copy)]
pub enum LlmFormat {
    Gemini,
    OpenAiImages,
    OpenAiResponses,
}

pub fn detect_format(path: &str) -> Option<LlmFormat> {
    if path.contains("generateContent") {
        Some(LlmFormat::Gemini)
    } else if path.contains("/images/generations") || path.contains("/images/edits") {
        Some(LlmFormat::OpenAiImages)
    } else if path.contains("/responses") {
        Some(LlmFormat::OpenAiResponses)
    } else {
        None
    }
}

// One proxied request; the response body is supplied once the stream completes.
pub struct PendingLog {
    pub label: String,
    pub format: LlmFormat,
    pub method: String,
    pub url: String,
    pub started_at: SystemTime,
    pub status: u16,
    pub request_body: Option<Vec<u8>>,
    pub error: Option<String>,
}

// Forward chunks to the caller while accumulating a copy, logging when the stream ends.
pub fn tee_and_log<S, B>(
    stream: S,
    log: PendingLog,
) -> impl Stream<Item = Result<B, reqwest::Error>>
where
    S: Stream<Item = Result<B, reqwest::Error>> + Send + 'static,
    B: AsRef<[u8]> + Send + 'static,
{
    let stream = Box::pin(stream);
    futures_util::stream::unfold(
        (stream, Vec::<u8>::new(), Some(log)),
        |(mut stream, mut acc, mut log)| async move {
            match stream.next().await {
                Some(Ok(chunk)) => {
                    acc.extend_from_slice(chunk.as_ref());
                    Some((Ok(chunk), (stream, acc, log)))
                }
                Some(Err(e)) => {
                    if let Some(mut l) = log.take() {
                        let prior = l.error.take();
                        let msg = e.to_string();
                        l.error = Some(match prior {
                            Some(p) => format!("{p}; stream error: {msg}"),
                            None => format!("stream error: {msg}"),
                        });
                        emit(l, std::mem::take(&mut acc));
                    }
                    Some((Err(e), (stream, acc, None)))
                }
                None => {
                    if let Some(l) = log.take() {
                        emit(l, std::mem::take(&mut acc));
                    }
                    None
                }
            }
        },
    )
}

fn emit(log: PendingLog, response_body: Vec<u8>) {
    let Some(cfg) = config() else { return };
    tokio::spawn(async move {
        if let Err(e) = post_run(cfg, log, response_body).await {
            eprintln!("[langsmith] log run failed: {e}");
        }
    });
}

fn body_to_value(bytes: &[u8]) -> Value {
    if bytes.is_empty() {
        return Value::Null;
    }
    match serde_json::from_slice::<Value>(bytes) {
        Ok(v) => v,
        Err(_) => json!({ "raw": String::from_utf8_lossy(bytes) }),
    }
}

// Parse the `data:` payloads out of an SSE stream, dropping keep-alives and `[DONE]`.
fn sse_data_jsons(bytes: &[u8]) -> Vec<Value> {
    let text = String::from_utf8_lossy(bytes);
    let mut out = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.trim_start().strip_prefix("data:") else {
            continue;
        };
        let payload = rest.trim();
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(payload) {
            out.push(v);
        }
    }
    out
}

// Reshape bodies into chat messages with `image_url` data-URLs, which LangSmith renders inline.
fn data_url(mime: &str, data: &str) -> String {
    format!("data:{mime};base64,{data}")
}

fn image_part(url: String) -> Value {
    json!({ "type": "image_url", "image_url": { "url": url, "detail": "high" } })
}

fn text_part(text: &str) -> Value {
    json!({ "type": "text", "text": text })
}

// A lone plain-text part renders better as a bare string than a one-element array.
fn content_value(parts: Vec<Value>) -> Value {
    if parts.len() == 1
        && parts[0].get("type").and_then(Value::as_str) == Some("text")
        && parts[0].get("thought").is_none()
        && let Some(text) = parts[0].get("text")
    {
        return text.clone();
    }
    Value::Array(parts)
}

fn parse_request(format: LlmFormat, bytes: &[u8]) -> Value {
    let Ok(body) = serde_json::from_slice::<Value>(bytes) else {
        return body_to_value(bytes);
    };
    match format {
        LlmFormat::Gemini => gemini_request(&body),
        LlmFormat::OpenAiImages => openai_images_request(&body),
        LlmFormat::OpenAiResponses => body,
    }
}

// Collapse a streamed (or single) response into one clean object; None falls back to raw.
fn parse_response(format: LlmFormat, bytes: &[u8]) -> Value {
    let parsed = match format {
        LlmFormat::Gemini => parse_gemini(bytes),
        LlmFormat::OpenAiImages => openai_images_response(bytes),
        LlmFormat::OpenAiResponses => parse_openai_responses(bytes),
    };
    parsed.unwrap_or_else(|| body_to_value(bytes))
}

fn gemini_collect_text(value: &Value) -> String {
    let mut text = String::new();
    if let Some(parts) = value.get("parts").and_then(Value::as_array) {
        for part in parts {
            if let Some(t) = part.get("text").and_then(Value::as_str) {
                text.push_str(t);
            }
        }
    }
    text
}

fn gemini_content_to_message(content: &Value) -> Value {
    let role = match content.get("role").and_then(Value::as_str) {
        Some("model") => "assistant",
        Some(role) => role,
        None => "user",
    };
    let mut parts = Vec::new();
    if let Some(arr) = content.get("parts").and_then(Value::as_array) {
        for part in arr {
            if let Some(t) = part.get("text").and_then(Value::as_str) {
                parts.push(text_part(t));
            } else if let Some(inline) = part.get("inlineData") {
                let mime = inline
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .unwrap_or("image/png");
                let data = inline.get("data").and_then(Value::as_str).unwrap_or("");
                parts.push(image_part(data_url(mime, data)));
            }
        }
    }
    json!({ "role": role, "content": content_value(parts) })
}

fn gemini_request(body: &Value) -> Value {
    let mut messages = Vec::new();
    if let Some(sys) = body.get("systemInstruction") {
        let text = gemini_collect_text(sys);
        if !text.is_empty() {
            messages.push(json!({ "role": "system", "content": text }));
        }
    }
    if let Some(contents) = body.get("contents").and_then(Value::as_array) {
        for content in contents {
            messages.push(gemini_content_to_message(content));
        }
    }
    json!({ "messages": messages })
}

fn gemini_usage(usage: &Value) -> Value {
    let count = |key| usage.get(key).and_then(Value::as_i64).unwrap_or(0);
    let mut out = json!({
        "input_tokens": count("promptTokenCount"),
        "output_tokens": count("candidatesTokenCount"),
        "total_tokens": count("totalTokenCount"),
    });
    if let Some(thoughts) = usage.get("thoughtsTokenCount").and_then(Value::as_i64) {
        out["output_token_details"] = json!({ "reasoning": thoughts });
    }
    out
}

fn parse_gemini(bytes: &[u8]) -> Option<Value> {
    let chunks = match serde_json::from_slice::<Value>(bytes) {
        Ok(Value::Array(array)) => array,
        Ok(object) => vec![object],
        Err(_) => sse_data_jsons(bytes),
    };
    if chunks.is_empty() {
        return None;
    }

    let mut text = String::new();
    let mut thought = String::new();
    let mut images = Vec::new();
    for chunk in &chunks {
        let Some(parts) = chunk
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for part in parts {
            if let Some(t) = part.get("text").and_then(Value::as_str) {
                if part
                    .get("thought")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    thought.push_str(t);
                } else {
                    text.push_str(t);
                }
            } else if let Some(inline) = part.get("inlineData") {
                let mime = inline
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .unwrap_or("image/png");
                let data = inline.get("data").and_then(Value::as_str).unwrap_or("");
                images.push(image_part(data_url(mime, data)));
            }
        }
    }

    let mut parts = Vec::new();
    if !thought.is_empty() {
        parts.push(json!({ "type": "text", "text": thought, "thought": true }));
    }
    if !text.is_empty() {
        parts.push(text_part(&text));
    }
    parts.extend(images);

    let mut out = serde_json::Map::new();
    out.insert("role".into(), json!("assistant"));
    out.insert(
        "content".into(),
        if parts.is_empty() {
            json!("")
        } else {
            content_value(parts)
        },
    );
    if let Some(usage) = chunks.last().and_then(|c| c.get("usageMetadata")) {
        out.insert("usage_metadata".into(), gemini_usage(usage));
    }
    Some(Value::Object(out))
}

fn openai_images_request(body: &Value) -> Value {
    let mut parts = Vec::new();
    if let Some(url) = body.pointer("/image/url").and_then(Value::as_str) {
        parts.push(image_part(url.to_string()));
    }
    if let Some(images) = body.get("images").and_then(Value::as_array) {
        for image in images {
            if let Some(url) = image.get("url").and_then(Value::as_str) {
                parts.push(image_part(url.to_string()));
            }
        }
    }
    parts.push(text_part(
        body.get("prompt").and_then(Value::as_str).unwrap_or(""),
    ));
    json!({ "messages": [{ "role": "user", "content": content_value(parts) }] })
}

fn openai_images_response(bytes: &[u8]) -> Option<Value> {
    let body: Value = serde_json::from_slice(bytes).ok()?;
    let data = body.get("data").and_then(Value::as_array)?;
    let mut parts = Vec::new();
    for item in data {
        if let Some(b64) = item.get("b64_json").and_then(Value::as_str) {
            parts.push(image_part(data_url("image/png", b64)));
        } else if let Some(url) = item.get("url").and_then(Value::as_str) {
            parts.push(image_part(url.to_string()));
        }
        if let Some(prompt) = item.get("revised_prompt").and_then(Value::as_str)
            && !prompt.is_empty()
        {
            parts.push(text_part(prompt));
        }
    }
    let mut out = serde_json::Map::new();
    out.insert("role".into(), json!("assistant"));
    out.insert("content".into(), Value::Array(parts));
    if let Some(ticks) = body
        .pointer("/usage/cost_in_usd_ticks")
        .and_then(Value::as_f64)
    {
        out.insert(
            "usage_metadata".into(),
            json!({ "output_cost": ticks / 10_000_000_000.0 }),
        );
    }
    Some(Value::Object(out))
}

fn parse_openai_responses(bytes: &[u8]) -> Option<Value> {
    if let Ok(v) = serde_json::from_slice::<Value>(bytes) {
        return Some(v);
    }
    let events = sse_data_jsons(bytes);
    if events.is_empty() {
        return None;
    }
    for event in events.iter().rev() {
        let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
        if matches!(
            kind,
            "response.completed" | "response.incomplete" | "response.failed"
        ) && let Some(response) = event.get("response")
        {
            return Some(response.clone());
        }
    }
    let mut text = String::new();
    for event in &events {
        if event.get("type").and_then(Value::as_str) == Some("response.output_text.delta")
            && let Some(delta) = event.get("delta").and_then(Value::as_str)
        {
            text.push_str(delta);
        }
    }
    (!text.is_empty()).then(|| json!({ "output_text": text }))
}

fn provider_from_url(url: &str) -> &'static str {
    if url.contains("x.ai") {
        "xai"
    } else if url.contains("googleapis") || url.contains("generativelanguage") {
        "google"
    } else if url.contains("openai") {
        "openai"
    } else {
        "unknown"
    }
}

fn model_name(format: LlmFormat, url: &str, request_body: Option<&[u8]>) -> Option<String> {
    match format {
        // .../models/{model}:generateContent
        LlmFormat::Gemini => {
            let tail = url.rsplit("/models/").next()?;
            let model = tail.split([':', '?', '/']).next()?;
            (!model.is_empty()).then(|| model.to_string())
        }
        _ => {
            let body: Value = serde_json::from_slice(request_body?).ok()?;
            body.get("model")
                .and_then(Value::as_str)
                .map(str::to_string)
        }
    }
}

async fn post_run(cfg: &Config, log: PendingLog, response_body: Vec<u8>) -> Result<(), String> {
    let run_id = Uuid::new_v4();
    let start: DateTime<Utc> = log.started_at.into();
    let end = Utc::now();
    let dotted_order = format!("{}{}", start.format("%Y%m%dT%H%M%S%6fZ"), run_id);

    let inputs = match &log.request_body {
        Some(b) => parse_request(log.format, b),
        None => Value::Null,
    };
    let outputs = parse_response(log.format, &response_body);

    let mut run = json!({
        "id": run_id,
        "trace_id": run_id,
        "dotted_order": dotted_order,
        "name": log.label,
        "run_type": "llm",
        "start_time": start.to_rfc3339_opts(SecondsFormat::Millis, true),
        "end_time": end.to_rfc3339_opts(SecondsFormat::Millis, true),
        "inputs": inputs,
        "outputs": outputs,
        "extra": {
            "metadata": {
                "label": log.label,
                "url": log.url,
                "method": log.method,
                "http_status": log.status,
            },
            "invocation_params": {
                "ls_provider": provider_from_url(&log.url),
                "ls_model_type": "chat",
                "ls_model_name": model_name(log.format, &log.url, log.request_body.as_deref()),
            },
        },
    });
    if let Some(project) = &cfg.project {
        run["session_name"] = json!(project);
    }
    if let Some(err) = &log.error {
        run["error"] = json!(err);
    }

    let payload = json!({ "post": [run], "patch": [] });
    let resp = client()
        .post(format!("{}/runs/batch", cfg.endpoint))
        .header("x-api-key", &cfg.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("{}: send: {e}", log.label))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("{}: {status}: {body}", log.label));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_formats() {
        assert!(matches!(
            detect_format("/v1beta/models/gemini-2.5-flash-image:generateContent"),
            Some(LlmFormat::Gemini)
        ));
        assert!(matches!(
            detect_format("/v1/images/generations"),
            Some(LlmFormat::OpenAiImages)
        ));
        assert!(matches!(
            detect_format("/v1/responses"),
            Some(LlmFormat::OpenAiResponses)
        ));
        assert!(detect_format("/world/reactor_token").is_none());
    }

    #[test]
    fn gemini_stream_assembles_text() {
        let sse = b"data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello\"}]}}]}\n\n\
                    data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" world\"}]}}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":2,\"totalTokenCount\":5}}\n\n";
        let out = parse_gemini(sse).unwrap();
        assert_eq!(out["content"], json!("Hello world"));
        assert_eq!(out["usage_metadata"]["input_tokens"], json!(3));
        assert_eq!(out["usage_metadata"]["total_tokens"], json!(5));
    }

    #[test]
    fn gemini_image_part_becomes_image_url() {
        let body = json!({
            "candidates": [{ "content": { "parts": [
                { "text": "here you go" },
                { "inlineData": { "mimeType": "image/png", "data": "AAAA" } }
            ] } }]
        });
        let out = parse_gemini(serde_json::to_vec(&body).unwrap().as_slice()).unwrap();
        let content = out["content"].as_array().unwrap();
        assert_eq!(content[0], text_part("here you go"));
        assert_eq!(content[1]["type"], json!("image_url"));
        assert_eq!(
            content[1]["image_url"]["url"],
            json!("data:image/png;base64,AAAA")
        );
    }

    #[test]
    fn openai_images_response_shapes_image_and_prompt() {
        let body = json!({
            "data": [{ "b64_json": "BBBB", "revised_prompt": "a cat" }],
            "usage": { "cost_in_usd_ticks": 10_000_000_000_i64 }
        });
        let out = openai_images_response(serde_json::to_vec(&body).unwrap().as_slice()).unwrap();
        let content = out["content"].as_array().unwrap();
        assert_eq!(
            content[0]["image_url"]["url"],
            json!("data:image/png;base64,BBBB")
        );
        assert_eq!(content[1], text_part("a cat"));
        assert_eq!(out["usage_metadata"]["output_cost"], json!(1.0));
    }

    #[test]
    fn openai_images_request_carries_refs_and_prompt() {
        let body = json!({
            "model": "grok-imagine-image",
            "prompt": "a dog",
            "image": { "url": "data:image/png;base64,REF" }
        });
        let out = openai_images_request(&body);
        let content = out["messages"][0]["content"].as_array().unwrap();
        assert_eq!(
            content[0]["image_url"]["url"],
            json!("data:image/png;base64,REF")
        );
        assert_eq!(content[1], text_part("a dog"));
    }

    #[test]
    fn responses_stream_prefers_completed_event() {
        let sse = b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hi\"}\n\n\
                    data: {\"type\":\"response.completed\",\"response\":{\"output\":[\"done\"]}}\n\n";
        let out = parse_openai_responses(sse).unwrap();
        assert_eq!(out, json!({ "output": ["done"] }));
    }

    #[test]
    fn model_name_from_gemini_path() {
        let name = model_name(
            LlmFormat::Gemini,
            "https://x/v1beta/models/gemini-2.5-flash-image:generateContent",
            None,
        );
        assert_eq!(name.as_deref(), Some("gemini-2.5-flash-image"));
    }
}

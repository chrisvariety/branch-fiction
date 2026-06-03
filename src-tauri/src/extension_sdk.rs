use std::sync::{Arc, RwLock};

use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};

#[derive(Clone, Default)]
pub struct ExtensionSdkState {
    inner: Arc<RwLock<Option<String>>>,
}

impl ExtensionSdkState {
    pub fn set(&self, source: String) {
        if let Ok(mut g) = self.inner.write() {
            *g = Some(source);
        }
    }

    pub fn get(&self) -> Option<String> {
        self.inner.read().ok().and_then(|g| g.clone())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_extension_sdk_source(
    state: tauri::State<'_, ExtensionSdkState>,
    source: String,
) -> Result<(), String> {
    if source.is_empty() {
        return Err("source must be non-empty".to_string());
    }
    state.set(source);
    Ok(())
}

pub async fn sdk_handler(
    State(state): State<ExtensionSdkState>,
) -> Result<impl IntoResponse, StatusCode> {
    let Some(source) = state.get() else {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/javascript; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((headers, source))
}

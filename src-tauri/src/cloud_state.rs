use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::Deserialize;

use crate::provider_proxy::AuthShape;

pub const CLOUD_PROVIDER_TYPE: &str = "cloud";
const CLOUD_TOKEN_URL: &str = "https://cloud.branchfiction.com/token";
const CLOUD_CATALOG_URL: &str = "https://cloud.branchfiction.com/catalog";

const JWT_REFRESH_AFTER_SECS: u64 = 50 * 60;
const CATALOG_TTL_SECS: u64 = 5 * 60;

#[derive(Clone, Default)]
pub struct CloudState {
    jwt_cache: Arc<Mutex<HashMap<String, CachedJwt>>>,
    catalog_cache: Arc<Mutex<Option<CachedCatalog>>>,
}

#[derive(Clone)]
struct CachedJwt {
    token: String,
    minted_at: u64,
}

#[derive(Clone)]
struct CachedCatalog {
    value: CloudCatalog,
    fetched_at: u64,
}

#[derive(Clone, Deserialize)]
pub struct CloudCatalog {
    pub providers: Vec<CloudProvider>,
    pub slots: HashMap<String, CloudSlot>,
}

#[derive(Clone, Deserialize)]
pub struct CloudProvider {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "proxyBaseUrl")]
    pub proxy_base_url: String,
    pub auth: AuthShape,
}

#[derive(Clone, Deserialize)]
pub struct CloudSlot {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "modelKey")]
    pub model_key: String,
    #[serde(default)]
    pub reasoning: Option<String>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl CloudState {
    pub async fn mint_or_get_jwt(&self, external_id: &str) -> Result<String, String> {
        let now = now_secs();
        {
            let cache = self.jwt_cache.lock().expect("cloud jwt cache poisoned");
            if let Some(cached) = cache.get(external_id)
                && now.saturating_sub(cached.minted_at) < JWT_REFRESH_AFTER_SECS
            {
                return Ok(cached.token.clone());
            }
        }
        let resp = Client::new()
            .post(CLOUD_TOKEN_URL)
            .json(&serde_json::json!({ "userId": external_id }))
            .send()
            .await
            .map_err(|e| format!("cloud /token: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("cloud /token returned {status}: {body}"));
        }
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("cloud /token json: {e}"))?;
        let token = body
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "cloud /token: missing token".to_string())?
            .to_string();

        let mut cache = self.jwt_cache.lock().expect("cloud jwt cache poisoned");
        cache.insert(
            external_id.to_string(),
            CachedJwt {
                token: token.clone(),
                minted_at: now,
            },
        );
        Ok(token)
    }

    pub async fn fetch_catalog(&self) -> Result<CloudCatalog, String> {
        let now = now_secs();
        {
            let cache = self
                .catalog_cache
                .lock()
                .expect("cloud catalog cache poisoned");
            if let Some(cached) = cache.as_ref()
                && now.saturating_sub(cached.fetched_at) < CATALOG_TTL_SECS
            {
                return Ok(cached.value.clone());
            }
        }
        let resp = Client::new()
            .get(CLOUD_CATALOG_URL)
            .send()
            .await
            .map_err(|e| format!("cloud /catalog: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("cloud /catalog returned {status}: {body}"));
        }
        let value: CloudCatalog = resp
            .json()
            .await
            .map_err(|e| format!("cloud /catalog json: {e}"))?;
        let mut cache = self
            .catalog_cache
            .lock()
            .expect("cloud catalog cache poisoned");
        *cache = Some(CachedCatalog {
            value: value.clone(),
            fetched_at: now,
        });
        Ok(value)
    }
}

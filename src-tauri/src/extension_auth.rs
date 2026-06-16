use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::http::StatusCode;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::Connection;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::db_path::open_main_db_ro;
use crate::extension_db::prepare_extension_db;
use crate::http_server::HttpPortState;
use crate::phone_share::PhoneShareState;
use crate::provider_resolve::{
    ManifestArea, parse_manifest_providers, resolve_options_meta, resolve_text_model_meta,
    useslot_provider_model_id,
};

const ALG: jsonwebtoken::Algorithm = jsonwebtoken::Algorithm::HS256;

#[derive(Debug)]
pub enum AuthError {
    Invalid,
    Expired,
    Revoked,
}

impl AuthError {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthError::Invalid => "invalid token",
            AuthError::Expired => "token expired",
            AuthError::Revoked => "token revoked",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    #[serde(rename = "bookId", default, skip_serializing_if = "Option::is_none")]
    pub book_id: Option<String>,
    #[serde(default)]
    pub providers: Map<String, Value>,
    #[serde(default)]
    pub config: Value,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
}

impl Claims {
    pub fn allows_provider(&self, key: &str) -> bool {
        self.providers.contains_key(key)
    }
}

pub struct ExtensionAuthState {
    signing_key: [u8; 32],
    valid_since: Mutex<HashMap<String, i64>>,
}

impl Default for ExtensionAuthState {
    fn default() -> Self {
        let mut key = [0u8; 32];
        getrandom::fill(&mut key).expect("getrandom failed for extension auth signing key");
        Self {
            signing_key: key,
            valid_since: Mutex::new(HashMap::new()),
        }
    }
}

pub type ExtensionAuth = Arc<ExtensionAuthState>;

pub fn new_state() -> ExtensionAuth {
    Arc::new(ExtensionAuthState::default())
}

impl ExtensionAuthState {
    pub fn mint(
        &self,
        extension_id: &str,
        book_id: Option<String>,
        providers: Map<String, Value>,
        config: Value,
        ttl_secs: i64,
    ) -> Result<String, String> {
        let now = chrono_now();
        let claims = Claims {
            sub: extension_id.to_string(),
            book_id,
            providers,
            config,
            iat: now,
            exp: now + ttl_secs,
            jti: Uuid::new_v4().simple().to_string(),
        };
        let header = Header::new(ALG);
        encode(
            &header,
            &claims,
            &EncodingKey::from_secret(&self.signing_key),
        )
        .map_err(|e| format!("jwt encode: {e}"))
    }

    pub fn verify(&self, token: &str) -> Result<Claims, AuthError> {
        let mut validation = Validation::new(ALG);
        validation.leeway = 5;
        validation.set_required_spec_claims(&["exp", "iat", "sub"]);
        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(&self.signing_key),
            &validation,
        )
        .map_err(|e| match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => AuthError::Expired,
            _ => AuthError::Invalid,
        })?;
        let claims = data.claims;
        let map = self.valid_since.lock().expect("auth state poisoned");
        if let Some(threshold) = map.get(&claims.sub)
            && claims.iat < *threshold
        {
            return Err(AuthError::Revoked);
        }
        Ok(claims)
    }

    pub fn revoke_extension(&self, extension_id: &str) {
        let mut map = self.valid_since.lock().expect("auth state poisoned");
        map.insert(extension_id.to_string(), chrono_now());
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Default session TTL; phone-share URLs override with a shorter value.
pub const DEFAULT_SESSION_TTL_SECS: i64 = 12 * 60 * 60;

pub fn verify_path_token(app: &AppHandle, token: &str) -> Result<Claims, (StatusCode, String)> {
    let auth = app.state::<ExtensionAuth>();
    auth.verify(token).map_err(|e| {
        let code = match e {
            AuthError::Expired => StatusCode::UNAUTHORIZED,
            AuthError::Revoked => StatusCode::UNAUTHORIZED,
            AuthError::Invalid => StatusCode::UNAUTHORIZED,
        };
        (code, e.as_str().to_string())
    })
}

#[derive(Deserialize)]
pub struct MintSessionArgs {
    #[serde(rename = "extensionId")]
    pub extension_id: String,
    #[serde(rename = "bookId", default)]
    pub book_id: Option<String>,
    #[serde(rename = "ttlSecs", default)]
    pub ttl_secs: Option<i64>,
}

#[derive(Serialize)]
pub struct MintSessionResponse {
    pub token: String,
    #[serde(rename = "dataBaseUrl")]
    pub data_base_url: String,
    #[serde(rename = "proxyBaseUrl")]
    pub proxy_base_url: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mint_extension_session_token(
    app: AppHandle,
    auth: tauri::State<'_, ExtensionAuth>,
    port: tauri::State<'_, HttpPortState>,
    args: MintSessionArgs,
) -> Result<MintSessionResponse, String> {
    if args.extension_id.is_empty() {
        return Err("extensionId is required".to_string());
    }
    prepare_extension_db(&app, &args.extension_id).await?;

    let (providers, config) = build_session_grant(&app, &args.extension_id).await?;

    let ttl = args.ttl_secs.unwrap_or(DEFAULT_SESSION_TTL_SECS);
    let token = auth.mint(&args.extension_id, args.book_id, providers, config, ttl)?;
    let data_base_url = format!("http://127.0.0.1:{}/extension-data/{}", port.0, token);
    let proxy_base_url = format!("http://127.0.0.1:{}/extension-providers/{}", port.0, token);
    Ok(MintSessionResponse {
        token,
        data_base_url,
        proxy_base_url,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn revoke_extension_session_tokens(
    auth: tauri::State<'_, ExtensionAuth>,
    phone_share: tauri::State<'_, PhoneShareState>,
    extension_id: String,
) -> Result<(), String> {
    auth.revoke_extension(&extension_id);
    phone_share.revoke_for_extension(&extension_id);
    Ok(())
}

// Per-area data collected while the DB is open; resolved into grant entries after (cloud may hit network).
enum PendingArea {
    UseSlot {
        key: String,
        role: String,
        provider_model_id: String,
    },
    Options {
        key: String,
        provider_type: String,
        base_url: Option<String>,
        override_base_url: Option<String>,
        auth_shape: String,
        model_key: Option<String>,
    },
}

async fn build_session_grant(
    app: &AppHandle,
    extension_id: &str,
) -> Result<(Map<String, Value>, Value), String> {
    let mut conn = open_main_db_ro(app).await?;

    let ext: Option<(i64, String, String)> =
        sqlx::query_as("SELECT enabled, config, manifest FROM extensions WHERE id = ?1")
            .bind(extension_id)
            .fetch_optional(&mut conn)
            .await
            .map_err(|e| format!("extensions query: {e}"))?;
    let (enabled, config_json, manifest_json) =
        ext.ok_or_else(|| format!("extension not installed: {extension_id}"))?;
    if enabled == 0 {
        return Err(format!("extension disabled: {extension_id}"));
    }
    let config: Value =
        serde_json::from_str(&config_json).unwrap_or_else(|_| Value::Object(Map::new()));

    // `useSlot` areas reference the org text model; `options` areas read their binding.
    let mut pending: Vec<PendingArea> = Vec::new();
    for area in parse_manifest_providers(&manifest_json) {
        match area.area {
            ManifestArea::UseSlot(role) => {
                if let Some(provider_model_id) =
                    useslot_provider_model_id(&mut conn, extension_id, &area.key, &role).await?
                {
                    pending.push(PendingArea::UseSlot {
                        key: area.key,
                        role,
                        provider_model_id,
                    });
                }
            }
            ManifestArea::Options => {
                let binding: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
                    "SELECT provider_id, override_base_url, model_key FROM extension_providers \
                     WHERE extension_id = ?1 AND provider_key = ?2",
                )
                .bind(extension_id)
                .bind(&area.key)
                .fetch_optional(&mut conn)
                .await
                .map_err(|e| format!("extension_providers query: {e}"))?;
                let Some((provider_id, override_base_url, model_key)) = binding else {
                    continue;
                };
                let prow: Option<(String, Option<String>, String)> = sqlx::query_as(
                    "SELECT type, base_url, auth_shape FROM providers WHERE id = ?1",
                )
                .bind(&provider_id)
                .fetch_optional(&mut conn)
                .await
                .map_err(|e| format!("providers query: {e}"))?;
                let Some((provider_type, base_url, auth_shape)) = prow else {
                    continue;
                };
                pending.push(PendingArea::Options {
                    key: area.key,
                    provider_type,
                    base_url,
                    override_base_url,
                    auth_shape,
                    model_key,
                });
            }
            ManifestArea::Unknown => {}
        }
    }
    let _ = conn.close().await;

    let mut providers = Map::new();
    for area in pending {
        let mut entry = Map::new();
        match area {
            PendingArea::UseSlot {
                key,
                role,
                provider_model_id,
            } => {
                let meta = resolve_text_model_meta(app, &provider_model_id, &role).await?;
                entry.insert("baseURL".to_string(), Value::String(String::new()));
                entry.insert(
                    "providerType".to_string(),
                    Value::String(meta.provider_type),
                );
                entry.insert("modelKey".to_string(), Value::String(meta.model_key));
                if let Some(r) = meta.reasoning {
                    entry.insert("reasoning".to_string(), Value::String(r));
                }
                providers.insert(key, Value::Object(entry));
            }
            PendingArea::Options {
                key,
                provider_type,
                base_url,
                override_base_url,
                auth_shape,
                model_key,
            } => {
                let meta = resolve_options_meta(
                    app,
                    extension_id,
                    &key,
                    &provider_type,
                    base_url.as_deref(),
                    override_base_url.as_deref(),
                    &auth_shape,
                )
                .await?;
                entry.insert("baseURL".to_string(), Value::String(meta.base_url));
                entry.insert(
                    "providerType".to_string(),
                    Value::String(meta.provider_type),
                );
                if let Some(mk) = meta.model_key.or(model_key) {
                    entry.insert("modelKey".to_string(), Value::String(mk));
                }
                if let Some(r) = meta.reasoning {
                    entry.insert("reasoning".to_string(), Value::String(r));
                }
                providers.insert(key, Value::Object(entry));
            }
        }
    }

    Ok((providers, config))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider_keys(keys: &[&str]) -> Map<String, Value> {
        let mut m = Map::new();
        for k in keys {
            m.insert((*k).into(), Value::Object(Map::new()));
        }
        m
    }

    #[test]
    fn mint_then_verify_roundtrip() {
        let state = ExtensionAuthState::default();
        let token = state
            .mint(
                "@local/cyoa",
                Some("book-1".into()),
                provider_keys(&["text", "image_generation_chat"]),
                Value::Null,
                3600,
            )
            .unwrap();
        let claims = state.verify(&token).unwrap();
        assert_eq!(claims.sub, "@local/cyoa");
        assert_eq!(claims.book_id.as_deref(), Some("book-1"));
        assert!(claims.allows_provider("text"));
        assert!(!claims.allows_provider("segmentation"));
    }

    #[test]
    fn revoke_invalidates_existing_tokens() {
        let state = ExtensionAuthState::default();
        let token = state
            .mint(
                "@local/cyoa",
                None,
                provider_keys(&["text"]),
                Value::Null,
                3600,
            )
            .unwrap();
        assert!(state.verify(&token).is_ok());
        std::thread::sleep(std::time::Duration::from_millis(1100));
        state.revoke_extension("@local/cyoa");
        match state.verify(&token) {
            Err(AuthError::Revoked) => {}
            other => panic!("expected Revoked, got {other:?}"),
        }
    }

    #[test]
    fn different_signing_keys_reject() {
        let state_a = ExtensionAuthState::default();
        let state_b = ExtensionAuthState::default();
        let token = state_a
            .mint("@local/cyoa", None, provider_keys(&[]), Value::Null, 3600)
            .unwrap();
        assert!(matches!(state_b.verify(&token), Err(AuthError::Invalid)));
    }
}

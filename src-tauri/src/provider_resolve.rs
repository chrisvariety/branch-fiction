// Shared provider resolution: app text model (BYO/cloud) and extension "options" bindings in one place.

use serde_json::Value;
use sqlx::{Connection, SqliteConnection};
use tauri::{AppHandle, Manager};

use crate::cloud_state::{CLOUD_PROVIDER_TYPE, CloudCatalog, CloudProvider, CloudSlot, CloudState};
use crate::db_path::open_main_db_ro;
use crate::provider_catalog::{base_url_for_type, provider_type_for_origin_and_auth};
use crate::provider_proxy::{AuthShape, ResolvedProvider};
use crate::provider_secret::decrypt_provider_secret;

const DEFAULT_USER_ID: &str = "default";
pub const DEFAULT_ORG_ID: &str = "default";

// Text roles for `useSlot`; match the cloud catalog's slot keys.
pub const PI_TEXT: &str = "piText";
pub const PI_TEXT_LIGHT: &str = "piTextLight";

// Fallback pi-ai type for a cloud-served origin the local catalog doesn't know.
const CLOUD_FALLBACK_PROVIDER_TYPE: &str = "openai_compatible";

fn text_model_column(role: &str) -> Option<&'static str> {
    match role {
        PI_TEXT => Some("text_provider_model_id"),
        PI_TEXT_LIGHT => Some("text_light_provider_model_id"),
        _ => None,
    }
}

// The provider_model the org has chosen for a text role, if any.
pub async fn org_text_model_id(
    conn: &mut SqliteConnection,
    organization_id: &str,
    role: &str,
) -> Result<Option<String>, String> {
    let Some(col) = text_model_column(role) else {
        return Ok(None);
    };
    let row: Option<(Option<String>,)> = sqlx::query_as(&format!(
        "SELECT {col} FROM organization_text_models WHERE organization_id = ?1"
    ))
    .bind(organization_id)
    .fetch_optional(conn)
    .await
    .map_err(|e| format!("organization_text_models {col} query: {e}"))?;
    Ok(row.and_then(|r| r.0))
}

async fn provider_model_id_by_key(
    conn: &mut SqliteConnection,
    provider_id: &str,
    model_key: &str,
) -> Result<Option<String>, String> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM provider_models WHERE provider_id = ?1 AND model_key = ?2 LIMIT 1",
    )
    .bind(provider_id)
    .bind(model_key)
    .fetch_optional(conn)
    .await
    .map_err(|e| format!("provider_models lookup: {e}"))?;
    Ok(row.map(|r| r.0))
}

// Resolve a `useSlot` area to a provider_model: extension-specific binding if set, else org default.
pub async fn useslot_provider_model_id(
    conn: &mut SqliteConnection,
    extension_id: &str,
    provider_key: &str,
    role: &str,
) -> Result<Option<String>, String> {
    let binding: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT provider_id, model_key FROM extension_providers \
         WHERE extension_id = ?1 AND provider_key = ?2",
    )
    .bind(extension_id)
    .bind(provider_key)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| format!("extension_providers query: {e}"))?;
    if let Some((provider_id, Some(model_key))) = binding
        && let Some(pmid) = provider_model_id_by_key(conn, &provider_id, &model_key).await?
    {
        return Ok(Some(pmid));
    }
    org_text_model_id(conn, DEFAULT_ORG_ID, role).await
}

// (p.type, pm.model_key, pm.reasoning, p.base_url, p.auth_shape, p.secret, p.secret_env_var, p.secret_priority, p.rpm_limit)
type TextModelRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    String,
    Option<i64>,
);

async fn read_text_model_row(
    conn: &mut SqliteConnection,
    provider_model_id: &str,
) -> Result<TextModelRow, String> {
    sqlx::query_as(
        "SELECT p.type, pm.model_key, pm.reasoning, p.base_url, p.auth_shape, p.secret, \
         p.secret_env_var, p.secret_priority, p.rpm_limit \
         FROM provider_models pm JOIN providers p ON pm.provider_id = p.id \
         WHERE pm.id = ?1 LIMIT 1",
    )
    .bind(provider_model_id)
    .fetch_optional(conn)
    .await
    .map_err(|e| format!("text model query: {e}"))?
    .ok_or_else(|| format!("no provider model {provider_model_id:?}"))
}

pub(crate) async fn cloud_external_id(conn: &mut SqliteConnection) -> Result<String, String> {
    sqlx::query_as::<_, (Option<String>,)>("SELECT external_id FROM users WHERE id = ?1")
        .bind(DEFAULT_USER_ID)
        .fetch_optional(conn)
        .await
        .map_err(|e| format!("users query: {e}"))?
        .and_then(|r| r.0)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "user has no cloud externalId — link your cloud account first".to_string())
}

// The catalog provider + slot backing a text role.
fn cloud_role<'a>(
    catalog: &'a CloudCatalog,
    role: &str,
) -> Result<(&'a CloudProvider, &'a CloudSlot), String> {
    let slot = catalog
        .slots
        .get(role)
        .ok_or_else(|| format!("cloud catalog has no mapping for role {role:?}"))?;
    let provider = catalog
        .providers
        .iter()
        .find(|p| p.base_url == slot.base_url)
        .ok_or_else(|| {
            format!(
                "cloud catalog role {role:?} references unknown baseUrl {:?}",
                slot.base_url
            )
        })?;
    Ok((provider, slot))
}

fn cloud_provider_type(provider: &CloudProvider) -> String {
    provider_type_for_origin_and_auth(&provider.base_url, &provider.auth)
        .map(str::to_string)
        .unwrap_or_else(|| CLOUD_FALLBACK_PROVIDER_TYPE.to_string())
}

// Pick a provider secret per its priority: an env var, or the stored (encrypted) key.
pub fn resolve_secret(
    app: &AppHandle,
    secret_priority: &str,
    secret_env_var: Option<String>,
    stored_secret: Option<String>,
) -> Result<Option<String>, String> {
    if secret_priority == "env" {
        Ok(secret_env_var
            .filter(|s| !s.is_empty())
            .and_then(|name| std::env::var(&name).ok()))
    } else {
        match stored_secret {
            Some(s) if !s.is_empty() => Ok(Some(decrypt_provider_secret(app, &s)?)),
            _ => Ok(None),
        }
    }
}

// Resolved app text model metadata; `provider_type` is always concrete, never the "cloud" marker.
pub struct TextModelMeta {
    pub provider_type: String,
    pub model_key: String,
    pub reasoning: Option<String>,
}

pub async fn resolve_text_model_meta(
    app: &AppHandle,
    provider_model_id: &str,
    role: &str,
) -> Result<TextModelMeta, String> {
    let mut conn = open_main_db_ro(app).await?;
    let (ptype, model_key, reasoning, ..) = read_text_model_row(&mut conn, provider_model_id).await?;
    let _ = conn.close().await;

    if ptype != CLOUD_PROVIDER_TYPE {
        return Ok(TextModelMeta {
            provider_type: ptype,
            model_key,
            reasoning,
        });
    }

    let catalog = app.state::<CloudState>().fetch_catalog().await?;
    let (provider, slot) = cloud_role(&catalog, role)?;
    Ok(TextModelMeta {
        provider_type: cloud_provider_type(provider),
        model_key: slot.model_key.clone(),
        reasoning: slot.reasoning.clone(),
    })
}

pub async fn resolve_text_model_transport(
    app: &AppHandle,
    provider_model_id: &str,
    role: &str,
) -> Result<ResolvedProvider, String> {
    let mut conn = open_main_db_ro(app).await?;
    let (ptype, _model_key, _reasoning, base_url, auth_shape, secret, secret_env_var, secret_priority, rpm_limit) =
        read_text_model_row(&mut conn, provider_model_id).await?;
    let rpm_limit = rpm_limit
        .filter(|v| *v > 0)
        .and_then(|v| u32::try_from(v).ok());

    if ptype == CLOUD_PROVIDER_TYPE {
        let external_id = cloud_external_id(&mut conn).await?;
        let _ = conn.close().await;
        let cloud = app.state::<CloudState>();
        let catalog = cloud.fetch_catalog().await?;
        let (provider, _slot) = cloud_role(&catalog, role)?;
        let token = cloud.mint_or_get_jwt(&external_id).await?;
        return Ok(ResolvedProvider {
            base_url: provider.proxy_base_url.clone(),
            auth: provider.auth.clone(),
            secret: Some(token),
            rpm_limit,
        });
    }
    let _ = conn.close().await;

    let base_url = base_url
        .or_else(|| base_url_for_type(&ptype).map(str::to_string))
        .ok_or_else(|| format!("text model {provider_model_id:?}: provider missing base_url"))?;
    let auth: AuthShape = serde_json::from_str(&auth_shape)
        .map_err(|e| format!("text model auth_shape parse: {e}"))?;
    let secret = resolve_secret(app, &secret_priority, secret_env_var, secret)?;
    Ok(ResolvedProvider {
        base_url,
        auth,
        secret,
        rpm_limit,
    })
}

// pi-ai metadata for an extension "options" binding: a concrete provider type and
// the upstream origin. Cloud-backed bindings are mapped through the catalog.
pub struct OptionsMeta {
    pub provider_type: String,
    pub base_url: String,
}

pub async fn resolve_options_meta(
    app: &AppHandle,
    provider_type: &str,
    stored_base_url: Option<&str>,
    override_base_url: Option<&str>,
    auth_shape_json: &str,
) -> Result<OptionsMeta, String> {
    if provider_type == CLOUD_PROVIDER_TYPE {
        let proxy = override_base_url
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "cloud-bound options binding missing override_base_url".to_string())?;
        let catalog = app.state::<CloudState>().fetch_catalog().await?;
        let provider = catalog
            .providers
            .iter()
            .find(|p| p.proxy_base_url == proxy)
            .ok_or_else(|| format!("cloud catalog has no provider for proxy {proxy:?}"))?;
        return Ok(OptionsMeta {
            provider_type: cloud_provider_type(provider),
            base_url: provider.base_url.clone(),
        });
    }

    let base_url = override_base_url
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| stored_base_url.map(str::to_string))
        .or_else(|| base_url_for_type(provider_type).map(str::to_string))
        .unwrap_or_default();
    let auth: AuthShape = serde_json::from_str(auth_shape_json)
        .map_err(|e| format!("options auth_shape parse: {e}"))?;
    let resolved = provider_type_for_origin_and_auth(&base_url, &auth)
        .map(str::to_string)
        .unwrap_or_else(|| provider_type.to_string());
    Ok(OptionsMeta {
        provider_type: resolved,
        base_url,
    })
}

// How an extension manifest declares a provider area.
pub enum ManifestArea {
    UseSlot(String),
    Options,
    Unknown,
}

pub struct ManifestProvider {
    pub key: String,
    pub area: ManifestArea,
}

pub fn parse_manifest_providers(manifest_json: &str) -> Vec<ManifestProvider> {
    let value: Value = serde_json::from_str(manifest_json).unwrap_or(Value::Null);
    let Some(arr) = value.get("providers").and_then(|p| p.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        let Some(key) = entry.get("key").and_then(|k| k.as_str()) else {
            continue;
        };
        let area = if let Some(role) = entry.get("useSlot").and_then(|s| s.as_str()) {
            ManifestArea::UseSlot(role.to_string())
        } else if entry.get("options").is_some() {
            ManifestArea::Options
        } else {
            ManifestArea::Unknown
        };
        out.push(ManifestProvider {
            key: key.to_string(),
            area,
        });
    }
    out
}

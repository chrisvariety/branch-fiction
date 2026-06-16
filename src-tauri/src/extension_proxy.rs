use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{HeaderMap, Method, StatusCode, Uri},
};
use sqlx::Connection;
use tauri::{AppHandle, Manager};

use crate::cloud_state::{CLOUD_PROVIDER_TYPE, CloudState};
use crate::db_path::open_main_db_ro;
use crate::extension_auth::verify_path_token;
use crate::provider_catalog::base_url_for_type;
use crate::provider_proxy::{AuthShape, ResolvedProvider, forward_to_provider};
use crate::provider_resolve::{
    ManifestArea, cloud_extension_slot, parse_manifest_providers, resolve_secret,
    resolve_text_model_transport, useslot_provider_model_id,
};

const DEFAULT_USER_ID: &str = "default";

type ProviderRow = (
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    String,
    String,
    Option<i64>,
);

pub async fn proxy_handler(
    State(app): State<AppHandle>,
    AxumPath((token, provider_key, rest)): AxumPath<(String, String, String)>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Result<axum::response::Response, (StatusCode, String)> {
    proxy_request(app, token, provider_key, rest, method, uri, headers, body).await
}

// `fullURL` provider options are hit at the bare proxy URL with no trailing path.
pub async fn proxy_handler_no_rest(
    State(app): State<AppHandle>,
    AxumPath((token, provider_key)): AxumPath<(String, String)>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Result<axum::response::Response, (StatusCode, String)> {
    proxy_request(
        app,
        token,
        provider_key,
        String::new(),
        method,
        uri,
        headers,
        body,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn proxy_request(
    app: AppHandle,
    token: String,
    provider_key: String,
    rest: String,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = verify_path_token(&app, &token)?;

    if !claims.allows_provider(&provider_key) {
        return Err((
            StatusCode::FORBIDDEN,
            format!("token does not grant access to provider '{provider_key}'"),
        ));
    }

    let resolved = resolve_provider(&app, &claims.sub, &provider_key)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;

    let label = format!("{}/{}", claims.sub, provider_key);
    forward_to_provider(&label, resolved, &rest, method, uri.query(), headers, body).await
}

async fn resolve_provider(
    app: &AppHandle,
    extension_id: &str,
    provider_key: &str,
) -> Result<ResolvedProvider, String> {
    let mut conn = open_main_db_ro(app).await?;

    // `useSlot` areas resolve against the org text model; others are options bindings.
    let manifest: Option<(String,)> =
        sqlx::query_as("SELECT manifest FROM extensions WHERE id = ?1")
            .bind(extension_id)
            .fetch_optional(&mut conn)
            .await
            .map_err(|e| format!("extensions query: {e}"))?;
    let manifest = manifest
        .ok_or_else(|| format!("extension not installed: {extension_id}"))?
        .0;
    let area = parse_manifest_providers(&manifest)
        .into_iter()
        .find(|p| p.key == provider_key)
        .map(|p| p.area);

    if let Some(ManifestArea::UseSlot(role)) = area {
        let provider_model_id =
            useslot_provider_model_id(&mut conn, extension_id, provider_key, &role)
                .await?
                .ok_or_else(|| format!("no text model configured for role {role:?}"))?;
        let _ = conn.close().await;
        return resolve_text_model_transport(app, &provider_model_id, &role).await;
    }

    resolve_options_transport(app, &mut conn, extension_id, provider_key).await
}

async fn resolve_options_transport(
    app: &AppHandle,
    conn: &mut sqlx::SqliteConnection,
    extension_id: &str,
    provider_key: &str,
) -> Result<ResolvedProvider, String> {
    let binding: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT provider_id, override_base_url FROM extension_providers \
         WHERE extension_id = ?1 AND provider_key = ?2",
    )
    .bind(extension_id)
    .bind(provider_key)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| format!("extension_providers query: {e}"))?;

    let (provider_id, override_base_url) = binding.ok_or_else(|| {
        format!("no provider bound for extension={extension_id} providerKey={provider_key}")
    })?;

    let row: ProviderRow = sqlx::query_as(
        "SELECT base_url, auth_shape, secret, secret_env_var, secret_priority, type, rpm_limit \
         FROM providers WHERE id = ?1",
    )
    .bind(&provider_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| format!("providers query: {e}"))?
    .ok_or_else(|| format!("provider row missing: {provider_id}"))?;

    let external_id: Option<String> = if row.5 == CLOUD_PROVIDER_TYPE {
        let user_row: Option<(Option<String>,)> =
            sqlx::query_as("SELECT external_id FROM users WHERE id = ?1")
                .bind(DEFAULT_USER_ID)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| format!("users query: {e}"))?;
        user_row.and_then(|r| r.0)
    } else {
        None
    };

    let provider_type = row.5;
    let stored_base_url = row.0;
    let stored_auth_shape = row.1;
    let stored_secret = row.2;
    let secret_env_var = row.3;
    let secret_priority = row.4;
    let rpm_limit = row.6.filter(|v| *v > 0).and_then(|v| u32::try_from(v).ok());

    if provider_type == CLOUD_PROVIDER_TYPE {
        let external_id = external_id.filter(|s| !s.is_empty()).ok_or_else(|| {
            "user has no cloud externalId — link your cloud account first".to_string()
        })?;
        let cloud = app.state::<CloudState>();
        let catalog = cloud.fetch_catalog().await?;
        let provider = match cloud_extension_slot(&catalog, extension_id, provider_key) {
            Ok((provider, _slot)) => provider,
            Err(_) => {
                let proxy = override_base_url.filter(|s| !s.is_empty()).ok_or_else(|| {
                    format!("extension_providers row for {extension_id}/{provider_key} bound to cloud is missing override_base_url")
                })?;
                catalog
                    .providers
                    .iter()
                    .find(|p| p.proxy_base_url == proxy)
                    .ok_or_else(|| format!("cloud catalog has no provider for proxy {proxy:?}"))?
            }
        };
        let token = cloud.mint_or_get_jwt(&external_id).await?;
        return Ok(ResolvedProvider {
            base_url: provider.proxy_base_url.clone(),
            auth: provider.auth.clone(),
            secret: Some(token),
            rpm_limit,
        });
    }

    let base_url = override_base_url
        .filter(|s| !s.is_empty())
        .or(stored_base_url)
        .or_else(|| base_url_for_type(&provider_type).map(str::to_string))
        .ok_or_else(|| "provider has no base_url".to_string())?;
    let auth: AuthShape = serde_json::from_str(&stored_auth_shape)
        .map_err(|e| format!("auth_shape parse for provider {provider_id}: {e}"))?;
    let secret = resolve_secret(app, &secret_priority, secret_env_var, stored_secret)?;

    Ok(ResolvedProvider {
        base_url,
        auth,
        secret,
        rpm_limit,
    })
}

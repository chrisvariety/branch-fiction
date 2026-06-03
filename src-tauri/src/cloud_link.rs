use sqlx::Connection;
use tauri::AppHandle;
use uuid::Uuid;

use crate::cloud_state::CLOUD_PROVIDER_TYPE;
use crate::db_path::open_main_db_rw;
use crate::provider_secret::encrypt_provider_secret;

const DEFAULT_ORG_ID: &str = "default";
const DEFAULT_USER_ID: &str = "default";
const CLOUD_PROVIDER_NAME: &str = "Cloud";
const CLOUD_PLACEHOLDER_MODEL_KEY: &str = "cloud";
const CLOUD_SECRET_LAST4: &str = "loud"; // "cloud".slice(-4), mirrors createProvider
const CLOUD_AUTH_SHAPE: &str = r#"{"kind":"none"}"#;

#[tauri::command(rename_all = "camelCase")]
pub async fn link_cloud_account(app: AppHandle, external_id: String) -> Result<(), String> {
    let mut conn = open_main_db_rw(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    // Only stamp externalId when a user row already exists (matches TS).
    let user_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?1")
        .bind(DEFAULT_USER_ID)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("user read: {e}"))?;
    if user_exists.is_some() {
        sqlx::query(
            "UPDATE users SET external_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        )
        .bind(&external_id)
        .bind(DEFAULT_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("user update: {e}"))?;
    }

    let secret = encrypt_provider_secret(&app, "cloud")?;

    let marker: Option<(String,)> =
        sqlx::query_as("SELECT id FROM providers WHERE organization_id = ?1 AND type = ?2 LIMIT 1")
            .bind(DEFAULT_ORG_ID)
            .bind(CLOUD_PROVIDER_TYPE)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("provider read: {e}"))?;

    if let Some((id,)) = marker {
        // Existing marker: refresh its fields, leave its model untouched.
        sqlx::query(
            "UPDATE providers SET name = ?1, secret = ?2, secret_last4 = ?3, secret_env_var = NULL, \
             base_url = NULL, auth_shape = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5",
        )
        .bind(CLOUD_PROVIDER_NAME)
        .bind(&secret)
        .bind(CLOUD_SECRET_LAST4)
        .bind(CLOUD_AUTH_SHAPE)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("provider update: {e}"))?;
    } else {
        // Fresh link: create the cloud provider + placeholder model; actual backing is resolved at request time.
        let provider_id = Uuid::now_v7().to_string();
        let model_id = Uuid::now_v7().to_string();

        sqlx::query(
            "INSERT INTO providers (id, organization_id, name, type, base_url, auth_shape, secret, secret_last4) \
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)",
        )
        .bind(&provider_id)
        .bind(DEFAULT_ORG_ID)
        .bind(CLOUD_PROVIDER_NAME)
        .bind(CLOUD_PROVIDER_TYPE)
        .bind(CLOUD_AUTH_SHAPE)
        .bind(&secret)
        .bind(CLOUD_SECRET_LAST4)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("provider insert: {e}"))?;

        sqlx::query(
            "INSERT INTO provider_models (id, provider_id, model_key, display_name, config) \
             VALUES (?1, ?2, ?3, ?4, NULL)",
        )
        .bind(&model_id)
        .bind(&provider_id)
        .bind(CLOUD_PLACEHOLDER_MODEL_KEY)
        .bind(CLOUD_PROVIDER_NAME)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("model insert: {e}"))?;
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    let _ = conn.close().await;
    Ok(())
}

use serde::Deserialize;
use sqlx::{Connection, Sqlite, Transaction};
use tauri::AppHandle;

use crate::db_path::open_main_db_rw;

// Upsert an extension -> provider binding (the source of truth resolved at install).
pub async fn upsert_extension_provider(
    tx: &mut Transaction<'_, Sqlite>,
    extension_id: &str,
    provider_key: &str,
    provider_id: &str,
    override_base_url: Option<&str>,
    model_key: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO extension_providers (extension_id, provider_key, provider_id, override_base_url, model_key) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(extension_id, provider_key) DO UPDATE SET \
           provider_id = excluded.provider_id, \
           override_base_url = excluded.override_base_url, \
           model_key = excluded.model_key, \
           updated_at = CURRENT_TIMESTAMP",
    )
    .bind(extension_id)
    .bind(provider_key)
    .bind(provider_id)
    .bind(override_base_url)
    .bind(model_key)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("upsert binding: {e}"))?;
    Ok(())
}

// Set the model an options binding uses.
#[tauri::command(rename_all = "camelCase")]
pub async fn set_extension_provider_model(
    app: AppHandle,
    extension_id: String,
    provider_key: String,
    model_key: String,
) -> Result<(), String> {
    let mut conn = open_main_db_rw(&app).await?;
    let result = sqlx::query(
        "UPDATE extension_providers SET model_key = ?1, updated_at = CURRENT_TIMESTAMP \
         WHERE extension_id = ?2 AND provider_key = ?3",
    )
    .bind(&model_key)
    .bind(&extension_id)
    .bind(&provider_key)
    .execute(&mut conn)
    .await
    .map_err(|e| format!("update model_key: {e}"))?;
    let _ = conn.close().await;
    if result.rows_affected() == 0 {
        return Err(format!(
            "no binding for extension={extension_id} providerKey={provider_key}"
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudBinding {
    extension_id: String,
    provider_key: String,
    provider_id: String,
    override_base_url: Option<String>,
    model_key: Option<String>,
}

// Write the JS-resolved cloud auto-configure bindings for unbound extension providers.
#[tauri::command(rename_all = "camelCase")]
pub async fn auto_configure_cloud_extensions(
    app: AppHandle,
    bindings: Vec<CloudBinding>,
) -> Result<(), String> {
    let mut conn = open_main_db_rw(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    for b in &bindings {
        upsert_extension_provider(
            &mut tx,
            &b.extension_id,
            &b.provider_key,
            &b.provider_id,
            b.override_base_url.as_deref(),
            b.model_key.as_deref(),
        )
        .await?;
    }
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    let _ = conn.close().await;
    Ok(())
}

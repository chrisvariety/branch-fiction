use sqlx::Connection;
use tauri::AppHandle;

use crate::db_path::open_main_db_rw;

// Delete a provider; clears extension bindings first (RESTRICT), then lets FK cascade null book_imports refs.
#[tauri::command(rename_all = "camelCase")]
pub async fn remove_provider(app: AppHandle, provider_id: String) -> Result<(), String> {
    let mut conn = open_main_db_rw(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    sqlx::query("DELETE FROM extension_providers WHERE provider_id = ?1")
        .bind(&provider_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("delete extension bindings: {e}"))?;
    sqlx::query("DELETE FROM provider_models WHERE provider_id = ?1")
        .bind(&provider_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("delete models: {e}"))?;
    sqlx::query("DELETE FROM providers WHERE id = ?1")
        .bind(&provider_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("delete provider: {e}"))?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    let _ = conn.close().await;
    Ok(())
}

use sqlx::Connection;
use tauri::AppHandle;

use crate::db_path::open_main_db_rw;

const DEFAULT_USER_ID: &str = "default";

#[tauri::command(rename_all = "camelCase")]
pub async fn link_cloud_account(app: AppHandle, external_id: String) -> Result<(), String> {
    let mut conn = open_main_db_rw(&app).await?;

    let user_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?1")
        .bind(DEFAULT_USER_ID)
        .fetch_optional(&mut conn)
        .await
        .map_err(|e| format!("user read: {e}"))?;
    if user_exists.is_some() {
        sqlx::query(
            "UPDATE users SET external_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        )
        .bind(&external_id)
        .bind(DEFAULT_USER_ID)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("user update: {e}"))?;
    }

    let _ = conn.close().await;
    Ok(())
}

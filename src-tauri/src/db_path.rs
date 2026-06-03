use std::path::PathBuf;
use std::str::FromStr;

use sqlx::ConnectOptions;
use sqlx::sqlite::SqliteConnectOptions;
use tauri::{AppHandle, Manager};

pub fn main_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("branch-fiction.db"))
}

pub async fn open_main_db_rw(app: &AppHandle) -> Result<sqlx::SqliteConnection, String> {
    SqliteConnectOptions::from_str(&main_db_path(app)?.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .connect()
        .await
        .map_err(|e| format!("sqlite connect: {e}"))
}

pub async fn open_main_db_ro(app: &AppHandle) -> Result<sqlx::SqliteConnection, String> {
    SqliteConnectOptions::from_str(&main_db_path(app)?.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|e| format!("sqlite connect: {e}"))
}

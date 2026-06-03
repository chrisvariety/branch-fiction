use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{ConnectOptions, Connection, Executor, SqliteConnection};
use tauri::{AppHandle, Manager};

use crate::db_path::main_db_path;

const EXTENSION_INIT_SQL: &str = include_str!("../extension_db_migrations/0001_init.sql");
const EXTENSION_DB_VERSION: i64 = 1;

const RESERVED_TABLES: &[(&str, &str)] = &[
    ("books", "id"),
    ("chapters", "book_id"),
    ("chapter_paragraphs", "book_id"),
    ("book_entities", "book_id"),
    ("book_arcs", "book_id"),
    ("book_entity_hierarchies", "book_id"),
    ("chapter_scenes", "book_id"),
    ("chapter_scene_groups", "book_id"),
    ("chapter_relationships", "book_id"),
    ("chapter_entity_appellations", "book_id"),
    ("chapter_entity_attributes", "book_id"),
    ("book_categories", "book_id"),
    ("book_character_place_scores", "book_id"),
    ("book_styles", "book_id"),
];

fn dir_name_for(extension_id: &str) -> String {
    extension_id.replace('/', "__")
}

fn extension_data_dir_at(
    app: &AppHandle,
    root_subdir: &str,
    extension_id: &str,
) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(dir.join(root_subdir).join(dir_name_for(extension_id)))
}

pub fn extension_data_dir(app: &AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    extension_data_dir_at(app, "extension-data", extension_id)
}

pub fn extension_dev_data_dir(app: &AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    extension_data_dir_at(app, "extension-data-dev", extension_id)
}

pub fn extension_assets_dir(app: &AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    Ok(extension_data_dir(app, extension_id)?.join("assets"))
}

/// Ensure the extension DB exists, run migrations, sync reserved tables from main, then close.
pub async fn prepare_extension_db(app: &AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    prepare_extension_db_at(app, &extension_data_dir(app, extension_id)?).await
}

pub async fn prepare_extension_dev_db(
    app: &AppHandle,
    extension_id: &str,
) -> Result<PathBuf, String> {
    prepare_extension_db_at(app, &extension_dev_data_dir(app, extension_id)?).await
}

async fn prepare_extension_db_at(app: &AppHandle, data_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(data_dir).map_err(|e| format!("mkdir extension-data: {e}"))?;
    std::fs::create_dir_all(data_dir.join("assets"))
        .map_err(|e| format!("mkdir extension-data/assets: {e}"))?;

    let db_path = data_dir.join("db.sqlite");
    let main_path = main_db_path(app)?;

    let mut conn = open_extension_conn(&db_path).await?;
    run_migrations(&mut conn).await?;

    if main_path.exists() {
        sync_book_data(&mut conn, &main_path).await?;
    }

    let _ = conn.close().await;
    Ok(db_path)
}

async fn open_extension_conn(db_path: &Path) -> Result<SqliteConnection, String> {
    let opts = SqliteConnectOptions::from_str(&db_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);
    opts.connect()
        .await
        .map_err(|e| format!("open extension db {}: {e}", db_path.display()))
}

/// Serialize migrations via `BEGIN IMMEDIATE`; the init script is idempotent so failed runs self-heal.
async fn run_migrations(conn: &mut SqliteConnection) -> Result<(), String> {
    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|e| format!("begin migration tx: {e}"))?;

    let result = run_migrations_inner(conn).await;

    if result.is_ok() {
        conn.execute("COMMIT")
            .await
            .map_err(|e| format!("commit migration tx: {e}"))?;
    } else {
        let _ = conn.execute("ROLLBACK").await;
    }
    result
}

async fn run_migrations_inner(conn: &mut SqliteConnection) -> Result<(), String> {
    let current = read_current_version(&mut *conn).await?;

    if current >= EXTENSION_DB_VERSION {
        return Ok(());
    }

    if current == 0 {
        conn.execute(EXTENSION_INIT_SQL)
            .await
            .map_err(|e| format!("extension migration 0001 failed: {e}"))?;
        return Ok(());
    }

    // No upgrade scripts registered yet. When we add 0002+ this is where
    // we'd run the missing scripts in order.
    Err(format!(
        "extension db at version {current}, expected {EXTENSION_DB_VERSION}, but no upgrade script registered"
    ))
}

async fn read_current_version(conn: &mut SqliteConnection) -> Result<i64, String> {
    let exists: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='book_migrations'",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| format!("check book_migrations: {e}"))?;
    if exists.is_none() {
        return Ok(0);
    }
    let row: Option<(Option<i64>,)> = sqlx::query_as("SELECT MAX(version) FROM book_migrations")
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| format!("read book_migrations: {e}"))?;
    Ok(row.and_then(|(v,)| v).unwrap_or(0))
}

async fn sync_book_data(
    extension_conn: &mut SqliteConnection,
    main_db_path: &Path,
) -> Result<(), String> {
    extension_conn
        .execute("PRAGMA foreign_keys = OFF")
        .await
        .map_err(|e| format!("pragma off: {e}"))?;

    let attach_sql = format!(
        "ATTACH DATABASE '{}' AS app",
        main_db_path.to_string_lossy().replace('\'', "''")
    );
    extension_conn
        .execute(attach_sql.as_str())
        .await
        .map_err(|e| format!("attach main db: {e}"))?;

    let result = copy_missing_books(extension_conn).await;

    let _ = extension_conn.execute("DETACH DATABASE app").await;
    let _ = extension_conn.execute("PRAGMA foreign_keys = ON").await;

    result
}

async fn copy_missing_books(extension_conn: &mut SqliteConnection) -> Result<(), String> {
    let seeded: Vec<(String,)> = sqlx::query_as("SELECT id FROM books")
        .fetch_all(&mut *extension_conn)
        .await
        .map_err(|e| format!("read seeded books: {e}"))?;
    let seeded: std::collections::HashSet<String> = seeded.into_iter().map(|(id,)| id).collect();

    let all: Vec<(String,)> = sqlx::query_as("SELECT id FROM app.books")
        .fetch_all(&mut *extension_conn)
        .await
        .map_err(|e| format!("read main books: {e}"))?;
    let all: std::collections::HashSet<String> = all.into_iter().map(|(id,)| id).collect();

    let to_seed: Vec<&String> = all.iter().filter(|id| !seeded.contains(*id)).collect();
    let to_prune: Vec<&String> = seeded.iter().filter(|id| !all.contains(*id)).collect();

    if to_seed.is_empty() && to_prune.is_empty() {
        return Ok(());
    }

    let mut tx = extension_conn
        .begin()
        .await
        .map_err(|e| format!("begin sync tx: {e}"))?;

    // Prune removed books so their slug/share_code UNIQUE slots are freed; FK order irrelevant (FKs OFF).
    for &book_id in &to_prune {
        for (table, book_id_col) in RESERVED_TABLES {
            let sql = format!("DELETE FROM \"{table}\" WHERE \"{book_id_col}\" = ?1");
            sqlx::query(&sql)
                .bind(book_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("prune {table} for book {book_id}: {e}"))?;
        }
    }

    for &book_id in &to_seed {
        for (table, book_id_col) in RESERVED_TABLES {
            let cols = insertable_columns(&mut tx, table).await?;
            if cols.is_empty() {
                continue;
            }
            let col_list = cols
                .iter()
                .map(|c| format!("\"{c}\""))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "INSERT INTO \"{table}\" ({col_list}) \
                 SELECT {col_list} FROM app.\"{table}\" WHERE \"{book_id_col}\" = ?1"
            );
            sqlx::query(&sql)
                .bind(book_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("seed {table} for book {book_id}: {e}"))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit sync tx: {e}"))?;

    Ok(())
}

type TableXinfoRow = (i64, String, String, i64, Option<String>, i64, i64);

async fn insertable_columns(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<String>, String> {
    // `hidden = 2/3` are STORED/VIRTUAL generated columns; both reject explicit INSERT values.
    let sql = format!("PRAGMA table_xinfo(\"{table}\")");
    let rows: Vec<TableXinfoRow> = sqlx::query_as(&sql)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| format!("table_xinfo({table}): {e}"))?;
    Ok(rows
        .into_iter()
        .filter(|(_, _, _, _, _, _, hidden)| *hidden != 2 && *hidden != 3)
        .map(|(_, name, _, _, _, _, _)| name)
        .collect())
}

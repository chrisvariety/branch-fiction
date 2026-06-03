use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{ConnectOptions, Connection, Executor, Row, SqliteConnection};
use tauri::{AppHandle, Manager};

use crate::db_path::main_db_path;
use crate::migrations::MAIN_MIGRATIONS;

/// Pipeline tables synced from the per-import DB to main at each checkpoint; order irrelevant (defer_foreign_keys).
const SHARED_TABLES: &[&str] = &[
    "chapters",
    "chapter_paragraphs",
    "chapter_scenes",
    "chapter_scene_groups",
    "chapter_entity_appellations",
    "chapter_entity_attributes",
    "chapter_relationships",
    "book_entities",
    "book_arcs",
    "book_entity_hierarchies",
    "book_categories",
    "book_character_place_scores",
    "book_styles",
    "book_entity_extraction_checkpoints",
    "pipeline_steps",
    "pipeline_step_usages",
];

pub fn import_db_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("book-imports"))
}

pub fn import_db_path(app: &AppHandle, book_import_id: &str) -> Result<PathBuf, String> {
    Ok(import_db_dir(app)?.join(format!("{book_import_id}.db")))
}

pub async fn prepare_import_db(app: &AppHandle, book_import_id: &str) -> Result<PathBuf, String> {
    let dir = import_db_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir book-imports: {e}"))?;

    let db_path = import_db_path(app, book_import_id)?;
    let mut conn = open_import_conn(&db_path).await?;
    apply_migrations(&mut conn).await?;
    let _ = conn.close().await;
    Ok(db_path)
}

pub fn delete_import_db(app: &AppHandle, book_import_id: &str) {
    let Ok(path) = import_db_path(app, book_import_id) else {
        return;
    };
    let _ = std::fs::remove_file(&path);
    // Best-effort cleanup of WAL sidecars.
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));
}

pub async fn sync_import_to_main(app: &AppHandle, book_import_id: &str) -> Result<(), String> {
    let import_path = import_db_path(app, book_import_id)?;
    if !import_path.exists() {
        return Ok(());
    }
    let main_path = main_db_path(app)?;

    let mut conn = SqliteConnectOptions::from_str(&main_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(30))
        .connect()
        .await
        .map_err(|e| format!("open main db: {e}"))?;

    let attach_sql = format!(
        "ATTACH DATABASE '{}' AS import",
        import_path.to_string_lossy().replace('\'', "''")
    );
    conn.execute(attach_sql.as_str())
        .await
        .map_err(|e| format!("attach import db: {e}"))?;

    let result = run_sync(&mut conn).await;

    let _ = conn.execute("DETACH DATABASE import").await;
    let _ = conn.close().await;
    result
}

async fn run_sync(conn: &mut SqliteConnection) -> Result<(), String> {
    let mut tx = conn.begin().await.map_err(|e| format!("begin sync: {e}"))?;
    tx.execute("PRAGMA defer_foreign_keys = ON")
        .await
        .map_err(|e| format!("defer fks: {e}"))?;

    for table in SHARED_TABLES {
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
            "INSERT OR REPLACE INTO \"{table}\" ({col_list}) \
             SELECT {col_list} FROM import.\"{table}\""
        );
        sqlx::query(&sql)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("sync {table}: {e}"))?;
    }
    tx.commit().await.map_err(|e| format!("commit sync: {e}"))?;
    Ok(())
}

async fn open_import_conn(db_path: &Path) -> Result<SqliteConnection, String> {
    SqliteConnectOptions::from_str(&db_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(false)
        .connect()
        .await
        .map_err(|e| format!("open import db {}: {e}", db_path.display()))
}

async fn apply_migrations(conn: &mut SqliteConnection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _import_migrations (\
            version INTEGER PRIMARY KEY, \
            description TEXT NOT NULL, \
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))\
         )",
    )
    .await
    .map_err(|e| format!("create _import_migrations: {e}"))?;

    conn.execute("BEGIN IMMEDIATE")
        .await
        .map_err(|e| format!("begin migration: {e}"))?;
    let result = apply_migrations_inner(conn).await;
    if result.is_ok() {
        conn.execute("COMMIT")
            .await
            .map_err(|e| format!("commit migration: {e}"))?;
    } else {
        let _ = conn.execute("ROLLBACK").await;
    }
    result
}

async fn apply_migrations_inner(conn: &mut SqliteConnection) -> Result<(), String> {
    let applied: Vec<(i64,)> = sqlx::query_as("SELECT version FROM _import_migrations")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| format!("read _import_migrations: {e}"))?;
    let applied: std::collections::HashSet<i64> = applied.into_iter().map(|(v,)| v).collect();

    for m in MAIN_MIGRATIONS {
        if applied.contains(&m.version) {
            continue;
        }
        conn.execute(m.sql)
            .await
            .map_err(|e| format!("import migration {} ({}): {e}", m.version, m.description))?;
        sqlx::query("INSERT INTO _import_migrations (version, description) VALUES (?1, ?2)")
            .bind(m.version)
            .bind(m.description)
            .execute(&mut *conn)
            .await
            .map_err(|e| format!("record migration {}: {e}", m.version))?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct PipelineStepRow {
    pub id: String,
    #[serde(rename = "bookImportId")]
    pub book_import_id: String,
    #[serde(rename = "stepId")]
    pub step_id: String,
    #[serde(rename = "fanOutKey")]
    pub fan_out_key: Option<String>,
    pub status: String,
    #[serde(rename = "attemptCount")]
    pub attempt_count: i64,
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
    pub narrative: serde_json::Value,
    pub logs: serde_json::Value,
    #[serde(rename = "startedAt")]
    pub started_at: Option<String>,
    #[serde(rename = "completedAt")]
    pub completed_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_pipeline_steps_for_import(
    app: AppHandle,
    book_import_id: String,
    step_id: Option<String>,
) -> Result<Vec<PipelineStepRow>, String> {
    let import_path = import_db_path(&app, &book_import_id)?;
    let db_path = if import_path.exists() {
        import_path
    } else {
        main_db_path(&app)?
    };
    let mut conn = SqliteConnectOptions::from_str(&db_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|e| format!("open {}: {e}", db_path.display()))?;

    let mut sql = String::from(
        "SELECT id, book_import_id, step_id, fan_out_key, status, attempt_count, \
         last_error, narrative, logs, started_at, completed_at, created_at, updated_at \
         FROM pipeline_steps WHERE book_import_id = ?1",
    );
    if step_id.is_some() {
        sql.push_str(" AND step_id = ?2");
    }

    let mut q = sqlx::query(&sql).bind(&book_import_id);
    if let Some(s) = &step_id {
        q = q.bind(s);
    }
    let rows = q
        .fetch_all(&mut conn)
        .await
        .map_err(|e| format!("pipeline_steps query: {e}"))?;
    let _ = conn.close().await;

    Ok(rows
        .into_iter()
        .map(|r| {
            let narrative = r
                .try_get::<Option<String>, _>(7)
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::Value::Array(Vec::new()));
            let logs = r
                .try_get::<Option<String>, _>(8)
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::Value::Array(Vec::new()));
            PipelineStepRow {
                id: r.try_get(0).unwrap_or_default(),
                book_import_id: r.try_get(1).unwrap_or_default(),
                step_id: r.try_get(2).unwrap_or_default(),
                fan_out_key: r.try_get(3).ok().flatten(),
                status: r.try_get(4).unwrap_or_default(),
                attempt_count: r.try_get(5).unwrap_or(0),
                last_error: r.try_get(6).ok().flatten(),
                narrative,
                logs,
                started_at: r.try_get(9).ok().flatten(),
                completed_at: r.try_get(10).ok().flatten(),
                created_at: r.try_get(11).unwrap_or_default(),
                updated_at: r.try_get(12).unwrap_or_default(),
            }
        })
        .collect())
}

#[derive(Serialize)]
pub struct SelectionEntityRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "significanceTier")]
    pub significance_tier: Option<String>,
    #[serde(rename = "significanceRank")]
    pub significance_rank: Option<i64>,
    pub aliases: serde_json::Value,
    pub pronouns: Option<String>,
    pub label: Option<String>,
    #[serde(rename = "minorStatus")]
    pub minor_status: String,
}

/// Read selection candidates from the per-import DB (same source as pipeline); falls back to main DB if gone.
#[tauri::command(rename_all = "camelCase")]
pub async fn read_selection_entities(
    app: AppHandle,
    book_import_id: String,
    book_id: String,
    entity_type: String,
) -> Result<Vec<SelectionEntityRow>, String> {
    let import_path = import_db_path(&app, &book_import_id)?;
    let db_path = if import_path.exists() {
        import_path
    } else {
        main_db_path(&app)?
    };
    let mut conn = SqliteConnectOptions::from_str(&db_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|e| format!("open {}: {e}", db_path.display()))?;

    let mut sql = String::from(
        "SELECT id, name, description, significance_tier, significance_rank, \
         aliases, pronouns, label, minor_status \
         FROM book_entities WHERE book_id = ?1 AND type = ?2",
    );
    // Only places with a significance_tier are pickable (active hierarchy level).
    if entity_type == "PLACE" {
        sql.push_str(" AND significance_tier IS NOT NULL");
    }
    sql.push_str(" ORDER BY significance_rank ASC, name ASC");

    let rows = sqlx::query(&sql)
        .bind(&book_id)
        .bind(&entity_type)
        .fetch_all(&mut conn)
        .await
        .map_err(|e| format!("read_selection_entities query: {e}"))?;
    let _ = conn.close().await;

    Ok(rows
        .into_iter()
        .map(|r| {
            let aliases = r
                .try_get::<Option<String>, _>(5)
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::Value::Array(Vec::new()));
            SelectionEntityRow {
                id: r.try_get(0).unwrap_or_default(),
                name: r.try_get(1).unwrap_or_default(),
                description: r.try_get(2).ok().flatten(),
                significance_tier: r.try_get(3).ok().flatten(),
                significance_rank: r.try_get(4).ok().flatten(),
                aliases,
                pronouns: r.try_get(6).ok().flatten(),
                label: r.try_get(7).ok().flatten(),
                minor_status: r.try_get(8).unwrap_or_default(),
            }
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionChange {
    pub id: String,
    pub significance_tier: String,
    pub significance_rank: i64,
}

/// Write selection changes to the per-import DB; no write contention (worker paused at awaiting_selection).
#[tauri::command(rename_all = "camelCase")]
pub async fn update_selection_entities(
    app: AppHandle,
    book_import_id: String,
    changes: Vec<SelectionChange>,
) -> Result<(), String> {
    if changes.is_empty() {
        return Ok(());
    }
    let import_path = import_db_path(&app, &book_import_id)?;
    if !import_path.exists() {
        return Err(format!(
            "import db not found for {book_import_id}; cannot persist selection"
        ));
    }
    let mut conn = open_import_conn(&import_path).await?;

    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    for change in &changes {
        sqlx::query(
            "UPDATE book_entities \
             SET significance_tier = ?1, significance_rank = ?2, updated_at = datetime('now') \
             WHERE id = ?3",
        )
        .bind(&change.significance_tier)
        .bind(change.significance_rank)
        .bind(&change.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("update_selection_entities: {e}"))?;
    }
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    let _ = conn.close().await;
    Ok(())
}

#[derive(Serialize)]
pub struct PipelineStepUsageSummary {
    pub calls: i64,
    #[serde(rename = "inputTokens")]
    pub input_tokens: i64,
    #[serde(rename = "outputTokens")]
    pub output_tokens: i64,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: i64,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: i64,
    #[serde(rename = "reasoningTokens")]
    pub reasoning_tokens: i64,
    #[serde(rename = "costTotal")]
    pub cost_total: f64,
    #[serde(rename = "callsWithReasoning")]
    pub calls_with_reasoning: i64,
    #[serde(rename = "callsWithCacheRead")]
    pub calls_with_cache_read: i64,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_pipeline_step_usages_for_import(
    app: AppHandle,
    book_import_id: String,
) -> Result<PipelineStepUsageSummary, String> {
    let import_path = import_db_path(&app, &book_import_id)?;
    let db_path = if import_path.exists() {
        import_path
    } else {
        main_db_path(&app)?
    };
    let mut conn = SqliteConnectOptions::from_str(&db_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|e| format!("open {}: {e}", db_path.display()))?;

    let row = sqlx::query(
        "SELECT \
            COUNT(u.id) AS calls, \
            COALESCE(SUM(u.input_tokens), 0) AS input_tokens, \
            COALESCE(SUM(u.output_tokens), 0) AS output_tokens, \
            COALESCE(SUM(u.cache_read_tokens), 0) AS cache_read_tokens, \
            COALESCE(SUM(u.cache_write_tokens), 0) AS cache_write_tokens, \
            COALESCE(SUM(u.reasoning_tokens), 0) AS reasoning_tokens, \
            COALESCE(SUM(u.cost_total), 0.0) AS cost_total, \
            COALESCE(SUM(CASE WHEN u.reasoning_tokens > 0 THEN 1 ELSE 0 END), 0) AS calls_with_reasoning, \
            COALESCE(SUM(CASE WHEN u.cache_read_tokens > 0 THEN 1 ELSE 0 END), 0) AS calls_with_cache_read \
         FROM pipeline_step_usages u \
         INNER JOIN pipeline_steps s ON s.id = u.pipeline_step_id \
         WHERE s.book_import_id = ?1",
    )
    .bind(&book_import_id)
    .fetch_one(&mut conn)
    .await
    .map_err(|e| format!("pipeline_step_usages summary: {e}"))?;
    let _ = conn.close().await;

    Ok(PipelineStepUsageSummary {
        calls: row.try_get("calls").unwrap_or(0),
        input_tokens: row.try_get("input_tokens").unwrap_or(0),
        output_tokens: row.try_get("output_tokens").unwrap_or(0),
        cache_read_tokens: row.try_get("cache_read_tokens").unwrap_or(0),
        cache_write_tokens: row.try_get("cache_write_tokens").unwrap_or(0),
        reasoning_tokens: row.try_get("reasoning_tokens").unwrap_or(0),
        cost_total: row.try_get("cost_total").unwrap_or(0.0),
        calls_with_reasoning: row.try_get("calls_with_reasoning").unwrap_or(0),
        calls_with_cache_read: row.try_get("calls_with_cache_read").unwrap_or(0),
    })
}

#[derive(Serialize)]
pub struct ModelProjection {
    #[serde(rename = "bookImportId")]
    pub book_import_id: String,
    #[serde(rename = "pipelineStepId")]
    pub pipeline_step_id: String,
    #[serde(rename = "stepId")]
    pub step_id: String,
    #[serde(rename = "completedAt")]
    pub completed_at: String,
    #[serde(rename = "wallSec")]
    pub wall_sec: f64,
    pub calls: i64,
    #[serde(rename = "inputTokens")]
    pub input_tokens: i64,
    #[serde(rename = "outputTokens")]
    pub output_tokens: i64,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: i64,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: i64,
    #[serde(rename = "reasoningTokens")]
    pub reasoning_tokens: i64,
    #[serde(rename = "costTotal")]
    pub cost_total: f64,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_model_projection(
    app: AppHandle,
    provider: String,
    model: String,
    step_ids: Vec<String>,
) -> Result<Option<ModelProjection>, String> {
    if step_ids.is_empty() {
        return Ok(None);
    }

    let main_path = main_db_path(&app)?;
    let mut conn = SqliteConnectOptions::from_str(&main_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|e| format!("open {}: {e}", main_path.display()))?;

    let placeholders = (0..step_ids.len())
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT \
           s.id AS pipeline_step_id, \
           s.book_import_id AS book_import_id, \
           s.step_id AS step_id, \
           s.completed_at AS completed_at, \
           (julianday(s.completed_at) - julianday(s.started_at)) * 86400.0 AS wall_sec, \
           COUNT(u.id) AS calls, \
           COALESCE(SUM(u.input_tokens), 0) AS input_tokens, \
           COALESCE(SUM(u.output_tokens), 0) AS output_tokens, \
           COALESCE(SUM(u.cache_read_tokens), 0) AS cache_read_tokens, \
           COALESCE(SUM(u.cache_write_tokens), 0) AS cache_write_tokens, \
           COALESCE(SUM(u.reasoning_tokens), 0) AS reasoning_tokens, \
           COALESCE(SUM(u.cost_total), 0.0) AS cost_total \
         FROM pipeline_steps s \
         INNER JOIN pipeline_step_usages u ON u.pipeline_step_id = s.id \
         WHERE s.status = 'completed' \
           AND s.started_at IS NOT NULL \
           AND s.completed_at IS NOT NULL \
           AND u.provider = ? \
           AND u.model = ? \
           AND s.step_id IN ({placeholders}) \
         GROUP BY s.id \
         HAVING COUNT(u.id) > 0 \
         ORDER BY s.completed_at DESC \
         LIMIT 1"
    );

    let mut q = sqlx::query(&sql).bind(&provider).bind(&model);
    for sid in &step_ids {
        q = q.bind(sid);
    }

    let row = q
        .fetch_optional(&mut conn)
        .await
        .map_err(|e| format!("model_projection: {e}"))?;
    let _ = conn.close().await;

    let Some(r) = row else {
        return Ok(None);
    };

    Ok(Some(ModelProjection {
        pipeline_step_id: r.try_get("pipeline_step_id").unwrap_or_default(),
        book_import_id: r.try_get("book_import_id").unwrap_or_default(),
        step_id: r.try_get("step_id").unwrap_or_default(),
        completed_at: r.try_get("completed_at").unwrap_or_default(),
        wall_sec: r.try_get("wall_sec").unwrap_or(0.0),
        calls: r.try_get("calls").unwrap_or(0),
        input_tokens: r.try_get("input_tokens").unwrap_or(0),
        output_tokens: r.try_get("output_tokens").unwrap_or(0),
        cache_read_tokens: r.try_get("cache_read_tokens").unwrap_or(0),
        cache_write_tokens: r.try_get("cache_write_tokens").unwrap_or(0),
        reasoning_tokens: r.try_get("reasoning_tokens").unwrap_or(0),
        cost_total: r.try_get("cost_total").unwrap_or(0.0),
    }))
}

type TableXinfoRow = (i64, String, String, i64, Option<String>, i64, i64);

async fn insertable_columns(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<String>, String> {
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

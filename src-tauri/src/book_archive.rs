use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, Executor, SqliteConnection};
use tauri::{AppHandle, Manager};

use crate::book_seeds::{
    SEED_CONTENT_TABLES, copy_content_table, extract_seed_assets, insert_book_row,
};
use crate::db_path::main_db_path;
use crate::extension_db::{
    RESERVED_TABLES, apply_book_payload_file, extension_assets_dir, extension_db_file,
    open_extension_conn, pending_payload_dir, refresh_book_in_extension_db,
};
use crate::migrations::MAIN_MIGRATIONS;

/// Pipeline bookkeeping shipped in user exports (not bundled seeds) so "Update" works after import.
const BOOK_PIPELINE_TABLES: &[&str] = &["book_imports", "pipeline_steps"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookDataDecl {
    table: String,
    book_id_column: String,
    #[serde(default)]
    asset_columns: Vec<String>,
}

fn safe_ident(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(|c: char| c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Portable asset URL ("file://bucket/key") -> relative path under an assets dir.
fn asset_rel_path(url: &str) -> Option<String> {
    let rel = url.strip_prefix("file://")?;
    let path = Path::new(rel);
    let safe = path.is_relative() && path.components().all(|c| matches!(c, Component::Normal(_)));
    (safe && !rel.is_empty()).then(|| rel.to_string())
}

async fn open_db_rw(path: &Path) -> Result<SqliteConnection, String> {
    SqliteConnectOptions::from_str(&path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(true)
        .foreign_keys(false)
        .busy_timeout(Duration::from_secs(30))
        .connect()
        .await
        .map_err(|e| format!("open {}: {e}", path.display()))
}

async fn attach(conn: &mut SqliteConnection, path: &Path, name: &str) -> Result<(), String> {
    let sql = format!(
        "ATTACH DATABASE '{}' AS {name}",
        path.to_string_lossy().replace('\'', "''")
    );
    conn.execute(sql.as_str())
        .await
        .map_err(|e| format!("attach {name}: {e}"))?;
    Ok(())
}

fn temp_path(label: &str) -> PathBuf {
    // Unique per call: concurrent inspect/import must not delete each other's files.
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "branch-fiction-{label}-{}-{seq}.db",
        std::process::id()
    ))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn export_book_archive(
    app: AppHandle,
    book_id: String,
    dest_path: String,
) -> Result<(), String> {
    let main_path = main_db_path(&app)?;
    let out_path = temp_path(&format!("export-{book_id}"));
    let _ = std::fs::remove_file(&out_path);

    let result = export_to(&app, &main_path, &out_path, &book_id, &dest_path).await;
    let _ = std::fs::remove_file(&out_path);
    result
}

async fn export_to(
    app: &AppHandle,
    main_path: &Path,
    out_path: &Path,
    book_id: &str,
    dest_path: &str,
) -> Result<(), String> {
    let mut conn = open_db_rw(out_path).await?;
    attach(&mut conn, main_path, "src").await?;

    let book: Option<(String, String, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT slug, title, image_url, status FROM src.books WHERE id = ?1")
            .bind(book_id)
            .fetch_optional(&mut conn)
            .await
            .map_err(|e| format!("read book: {e}"))?;
    let Some((slug, title, image_url, status)) = book else {
        return Err("book not found".into());
    };
    // Main holds the last completed state, so a paused "Update" doesn't block export.
    if status.as_deref() != Some("completed") {
        return Err("book import is not finished".into());
    }

    let import_ids: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM src.book_imports WHERE book_id = ?1")
            .bind(book_id)
            .fetch_all(&mut conn)
            .await
            .map_err(|e| format!("list book imports: {e}"))?;
    let running = {
        let state = app.state::<crate::pipeline_worker::PipelineWorkerState>();
        let map = state.children.lock().map_err(|e| e.to_string())?;
        import_ids.iter().any(|(id,)| map.contains_key(id))
    };
    if running {
        return Err("book import is currently running".into());
    }

    sqlx::query("CREATE TABLE books AS SELECT * FROM src.books WHERE id = ?1")
        .bind(book_id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("copy books: {e}"))?;
    conn.execute("UPDATE books SET user_id = 'default'")
        .await
        .map_err(|e| format!("rewrite books.user_id: {e}"))?;

    for table in SEED_CONTENT_TABLES {
        let sql =
            format!("CREATE TABLE \"{table}\" AS SELECT * FROM src.\"{table}\" WHERE book_id = ?1");
        sqlx::query(&sql)
            .bind(book_id)
            .execute(&mut conn)
            .await
            .map_err(|e| format!("copy {table}: {e}"))?;
    }

    sqlx::query("CREATE TABLE book_imports AS SELECT * FROM src.book_imports WHERE book_id = ?1")
        .bind(book_id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("copy book_imports: {e}"))?;
    // Strip machine-local references; providers never travel with books.
    conn.execute(
        "UPDATE book_imports SET user_id = 'default', text_provider_model_id = NULL, \
         text_light_provider_model_id = NULL, previous_in_series_book_id = NULL",
    )
    .await
    .map_err(|e| format!("rewrite book_imports: {e}"))?;

    sqlx::query(
        "CREATE TABLE pipeline_steps AS SELECT * FROM src.pipeline_steps \
         WHERE book_import_id IN (SELECT id FROM src.book_imports WHERE book_id = ?1)",
    )
    .bind(book_id)
    .execute(&mut conn)
    .await
    .map_err(|e| format!("copy pipeline_steps: {e}"))?;

    pack_cover(app, &mut conn, image_url.as_deref()).await?;
    pack_extension_payloads(app, &mut conn, book_id).await?;

    let current_version = MAIN_MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
    conn.execute("CREATE TABLE _seed_meta (key text PRIMARY KEY, value text NOT NULL)")
        .await
        .map_err(|e| format!("create _seed_meta: {e}"))?;
    let exported_at: (String,) = sqlx::query_as("SELECT datetime('now')")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| format!("read now: {e}"))?;
    let meta = [
        ("schema_version", current_version.to_string()),
        ("book_id", book_id.to_string()),
        ("slug", slug),
        ("title", title),
        ("exported_at", exported_at.0),
        ("kind", "book-archive".to_string()),
    ];
    for (key, value) in meta {
        sqlx::query("INSERT INTO _seed_meta (key, value) VALUES (?1, ?2)")
            .bind(key)
            .bind(value)
            .execute(&mut conn)
            .await
            .map_err(|e| format!("write _seed_meta {key}: {e}"))?;
    }

    let _ = conn.execute("DETACH DATABASE src").await;
    let _ = conn.close().await;

    gzip_file(out_path, Path::new(dest_path))
}

async fn pack_cover(
    app: &AppHandle,
    conn: &mut SqliteConnection,
    image_url: Option<&str>,
) -> Result<(), String> {
    let Some(rel) = image_url.and_then(asset_rel_path) else {
        return Ok(());
    };
    let abs = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("storage")
        .join(&rel);
    let Ok(data) = std::fs::read(&abs) else {
        eprintln!("cover not found, skipping: {}", abs.display());
        return Ok(());
    };
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _seed_assets (path text PRIMARY KEY, data blob NOT NULL)",
    )
    .await
    .map_err(|e| format!("create _seed_assets: {e}"))?;
    sqlx::query("INSERT OR REPLACE INTO _seed_assets (path, data) VALUES (?1, ?2)")
        .bind(rel)
        .bind(data)
        .execute(&mut *conn)
        .await
        .map_err(|e| format!("pack cover: {e}"))?;
    Ok(())
}

async fn pack_extension_payloads(
    app: &AppHandle,
    conn: &mut SqliteConnection,
    book_id: &str,
) -> Result<(), String> {
    let extensions: Vec<(String, String, String, String)> =
        sqlx::query_as("SELECT id, name, version, manifest FROM src.extensions")
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| format!("list extensions: {e}"))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS _ext_payloads (\
            extension_id text PRIMARY KEY, \
            name text NOT NULL, \
            extension_version text NOT NULL, \
            tables_json text NOT NULL, \
            data blob NOT NULL\
         )",
    )
    .await
    .map_err(|e| format!("create _ext_payloads: {e}"))?;

    for (ext_id, name, version, manifest) in extensions {
        let manifest: serde_json::Value = match serde_json::from_str(&manifest) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let Some(decls) = manifest.get("bookData") else {
            continue;
        };
        let decls: Vec<BookDataDecl> = match serde_json::from_value(decls.clone()) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("extension {ext_id}: invalid bookData: {e}");
                continue;
            }
        };
        let db_file = extension_db_file(app, &ext_id)?;
        if decls.is_empty() || !db_file.exists() {
            continue;
        }

        let payload_path = temp_path(&format!("payload-{}", ext_id.replace('/', "__")));
        let _ = std::fs::remove_file(&payload_path);
        let result =
            build_extension_payload(app, &ext_id, &db_file, &payload_path, &decls, book_id).await;
        match result {
            Ok(tables) if !tables.is_empty() => {
                let data = std::fs::read(&payload_path)
                    .map_err(|e| format!("read payload {ext_id}: {e}"))?;
                let tables_json = serde_json::to_string(&tables).unwrap_or_else(|_| "[]".into());
                sqlx::query(
                    "INSERT OR REPLACE INTO _ext_payloads \
                     (extension_id, name, extension_version, tables_json, data) \
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .bind(&ext_id)
                .bind(&name)
                .bind(&version)
                .bind(tables_json)
                .bind(data)
                .execute(&mut *conn)
                .await
                .map_err(|e| format!("store payload {ext_id}: {e}"))?;
            }
            Ok(_) => {}
            Err(e) => eprintln!("extension {ext_id}: payload export failed: {e}"),
        }
        let _ = std::fs::remove_file(&payload_path);
    }
    Ok(())
}

/// Builds a standalone payload db (original DDL + book rows + assets); returns the tables packed.
async fn build_extension_payload(
    app: &AppHandle,
    ext_id: &str,
    ext_db: &Path,
    payload_path: &Path,
    decls: &[BookDataDecl],
    book_id: &str,
) -> Result<Vec<String>, String> {
    let reserved: HashSet<&str> = RESERVED_TABLES
        .iter()
        .map(|(t, _)| *t)
        .chain(["book_migrations", "extension_seeds"])
        .collect();

    let mut conn = open_db_rw(payload_path).await?;
    attach(&mut conn, ext_db, "ext").await?;

    let mut packed: Vec<String> = Vec::new();
    let mut asset_rels: HashSet<String> = HashSet::new();

    conn.execute("CREATE TABLE _payload_meta (key text PRIMARY KEY, value text NOT NULL)")
        .await
        .map_err(|e| format!("create _payload_meta: {e}"))?;
    sqlx::query("INSERT INTO _payload_meta (key, value) VALUES ('book_id', ?1)")
        .bind(book_id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("write _payload_meta: {e}"))?;
    conn.execute(
        "CREATE TABLE _payload_tables (tbl text PRIMARY KEY, book_id_column text NOT NULL)",
    )
    .await
    .map_err(|e| format!("create _payload_tables: {e}"))?;

    for decl in decls {
        if !safe_ident(&decl.table)
            || !safe_ident(&decl.book_id_column)
            || decl.asset_columns.iter().any(|c| !safe_ident(c))
        {
            eprintln!(
                "extension {ext_id}: invalid bookData identifiers for {}",
                decl.table
            );
            continue;
        }
        if reserved.contains(decl.table.as_str()) {
            eprintln!(
                "extension {ext_id}: bookData table {} is host-managed",
                decl.table
            );
            continue;
        }
        let table = &decl.table;
        let col = &decl.book_id_column;

        let ddl: Option<(Option<String>,)> =
            sqlx::query_as("SELECT sql FROM ext.sqlite_master WHERE type = 'table' AND name = ?1")
                .bind(table)
                .fetch_optional(&mut conn)
                .await
                .map_err(|e| format!("read ddl for {table}: {e}"))?;
        let Some((Some(create_sql),)) = ddl else {
            continue;
        };
        conn.execute(create_sql.as_str())
            .await
            .map_err(|e| format!("create payload {table}: {e}"))?;

        let indexes: Vec<(String,)> = sqlx::query_as(
            "SELECT sql FROM ext.sqlite_master \
             WHERE type = 'index' AND tbl_name = ?1 AND sql IS NOT NULL",
        )
        .bind(table)
        .fetch_all(&mut conn)
        .await
        .map_err(|e| format!("list indexes for {table}: {e}"))?;
        for (create_idx,) in indexes {
            if let Err(e) = conn.execute(create_idx.as_str()).await {
                eprintln!("extension {ext_id}: payload index on {table}: {e}");
            }
        }

        let cols = insertable_columns(&mut conn, "ext.", table).await?;
        if cols.is_empty() {
            continue;
        }
        let col_list = cols
            .iter()
            .map(|c| format!("\"{c}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let copy_sql = format!(
            "INSERT INTO \"{table}\" ({col_list}) \
             SELECT {col_list} FROM ext.\"{table}\" WHERE \"{col}\" = ?1"
        );
        sqlx::query(&copy_sql)
            .bind(book_id)
            .execute(&mut conn)
            .await
            .map_err(|e| format!("copy payload {table}: {e}"))?;

        for asset_col in &decl.asset_columns {
            let urls: Vec<(String,)> = sqlx::query_as(&format!(
                "SELECT DISTINCT \"{asset_col}\" FROM \"{table}\" \
                 WHERE \"{asset_col}\" LIKE 'file://%'"
            ))
            .fetch_all(&mut conn)
            .await
            .map_err(|e| format!("list assets {table}.{asset_col}: {e}"))?;
            asset_rels.extend(urls.into_iter().filter_map(|(u,)| asset_rel_path(&u)));
        }

        sqlx::query("INSERT OR REPLACE INTO _payload_tables (tbl, book_id_column) VALUES (?1, ?2)")
            .bind(table)
            .bind(col)
            .execute(&mut conn)
            .await
            .map_err(|e| format!("record payload table {table}: {e}"))?;
        packed.push(table.clone());
    }

    if !asset_rels.is_empty() {
        conn.execute("CREATE TABLE _seed_assets (path text PRIMARY KEY, data blob NOT NULL)")
            .await
            .map_err(|e| format!("create payload _seed_assets: {e}"))?;
        let assets_dir = extension_assets_dir(app, ext_id)?;
        let mut rels: Vec<String> = asset_rels.into_iter().collect();
        rels.sort();
        for rel in rels {
            let abs = assets_dir.join(&rel);
            let Ok(data) = std::fs::read(&abs) else {
                eprintln!("extension {ext_id}: asset not found, skipping: {rel}");
                continue;
            };
            sqlx::query("INSERT OR REPLACE INTO _seed_assets (path, data) VALUES (?1, ?2)")
                .bind(&rel)
                .bind(data)
                .execute(&mut conn)
                .await
                .map_err(|e| format!("pack asset {rel}: {e}"))?;
        }
    }

    let _ = conn.execute("DETACH DATABASE ext").await;
    let _ = conn.close().await;
    Ok(packed)
}

fn gzip_file(src: &Path, dest: &Path) -> Result<(), String> {
    let mut input = std::fs::File::open(src).map_err(|e| format!("open {}: {e}", src.display()))?;
    let output =
        std::fs::File::create(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let mut encoder = flate2::write::GzEncoder::new(output, flate2::Compression::best());
    std::io::copy(&mut input, &mut encoder).map_err(|e| format!("gzip: {e}"))?;
    encoder.finish().map_err(|e| format!("gzip finish: {e}"))?;
    Ok(())
}

/// Returns a readable sqlite path; gzipped input (sniffed by magic bytes) is inflated to a temp file.
fn materialize_archive(path: &Path) -> Result<(PathBuf, bool), String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut magic = [0u8; 2];
    let n = file
        .read(&mut magic)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    if n < 2 || magic != [0x1f, 0x8b] {
        return Ok((path.to_path_buf(), false));
    }
    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut decoder = flate2::read::GzDecoder::new(file);
    let tmp = temp_path("archive");
    let mut out =
        std::fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
    std::io::copy(&mut decoder, &mut out).map_err(|e| format!("gunzip {}: {e}", path.display()))?;
    Ok((tmp, true))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExtension {
    pub id: String,
    pub name: String,
    pub installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveInfo {
    pub book_id: String,
    pub title: String,
    pub exists: bool,
    pub extensions: Vec<ArchiveExtension>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn inspect_book_archive(app: AppHandle, path: String) -> Result<ArchiveInfo, String> {
    let (db_file, is_temp) = materialize_archive(Path::new(&path))?;
    let result = inspect_archive_db(&app, &db_file).await;
    if is_temp {
        let _ = std::fs::remove_file(&db_file);
    }
    result
}

async fn inspect_archive_db(app: &AppHandle, db_file: &Path) -> Result<ArchiveInfo, String> {
    let mut conn = SqliteConnectOptions::from_str(&db_file.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|_| "not a Branch Fiction book file".to_string())?;

    let meta = read_archive_meta(&mut conn).await?;
    let book_id = meta
        .get("book_id")
        .cloned()
        .ok_or("archive missing book_id")?;
    let title = meta.get("title").cloned().unwrap_or_default();
    check_schema_version(&meta)?;

    let has_payloads: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_ext_payloads'",
    )
    .fetch_optional(&mut conn)
    .await
    .map_err(|e| format!("check _ext_payloads: {e}"))?;
    let mut extensions = Vec::new();
    if has_payloads.is_some() {
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT extension_id, name FROM _ext_payloads ORDER BY extension_id")
                .fetch_all(&mut conn)
                .await
                .map_err(|e| format!("list payloads: {e}"))?;
        for (id, name) in rows {
            let installed = extension_db_file(app, &id).is_ok_and(|p| p.exists());
            extensions.push(ArchiveExtension {
                id,
                name,
                installed,
            });
        }
    }
    let _ = conn.close().await;

    let main_path = main_db_path(app)?;
    let mut main = SqliteConnectOptions::from_str(&main_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|e| format!("open main db: {e}"))?;
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM books WHERE id = ?1")
        .bind(&book_id)
        .fetch_optional(&mut main)
        .await
        .map_err(|e| format!("check book: {e}"))?;
    let _ = main.close().await;

    Ok(ArchiveInfo {
        book_id,
        title,
        exists: exists.is_some(),
        extensions,
    })
}

async fn read_archive_meta(conn: &mut SqliteConnection) -> Result<HashMap<String, String>, String> {
    sqlx::query_as::<_, (String, String)>("SELECT key, value FROM _seed_meta")
        .fetch_all(conn)
        .await
        .map(|rows| rows.into_iter().collect())
        .map_err(|_| "not a Branch Fiction book file".to_string())
}

fn check_schema_version(meta: &HashMap<String, String>) -> Result<(), String> {
    let schema_version: i64 = meta
        .get("schema_version")
        .and_then(|v| v.parse().ok())
        .ok_or("archive missing schema_version")?;
    let current_version = MAIN_MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
    if schema_version > current_version {
        return Err(
            "this file was exported by a newer version of the app — update the app to import it"
                .into(),
        );
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBook {
    pub book_id: String,
    pub title: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn import_book_archive(
    app: AppHandle,
    path: String,
    replace: bool,
) -> Result<ImportedBook, String> {
    // Concurrent imports contend on the main db write lock; run them one at a time.
    static IMPORT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = IMPORT_LOCK.lock().await;

    let (db_file, is_temp) = materialize_archive(Path::new(&path))?;
    let result = import_archive_db(&app, &db_file, replace).await;
    if is_temp {
        let _ = std::fs::remove_file(&db_file);
    }
    result
}

async fn import_archive_db(
    app: &AppHandle,
    db_file: &Path,
    replace: bool,
) -> Result<ImportedBook, String> {
    let main_path = main_db_path(app)?;
    let mut conn = SqliteConnectOptions::from_str(&main_path.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(30))
        .connect()
        .await
        .map_err(|e| format!("open main db: {e}"))?;
    attach(&mut conn, db_file, "seed").await?;

    let result = import_archive_inner(app, &mut conn, replace).await;

    let _ = conn.execute("DETACH DATABASE seed").await;
    let _ = conn.close().await;

    let imported = result?;
    refresh_installed_extension_dbs(app, &main_path, &imported.book_id).await;
    apply_extension_payloads(app, db_file, &imported.book_id).await?;
    Ok(imported)
}

/// Reserved-table sync only adds missing books, so replaced books must be refreshed in place.
async fn refresh_installed_extension_dbs(app: &AppHandle, main_path: &Path, book_id: &str) {
    let Ok(root) = app.path().app_data_dir() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(root.join("extension-data")) else {
        return;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let db = entry.path().join("db.sqlite");
        if !db.exists() {
            continue;
        }
        match open_extension_conn(&db).await {
            Ok(mut conn) => {
                if let Err(e) = refresh_book_in_extension_db(&mut conn, main_path, book_id).await {
                    eprintln!("refresh book in {}: {e}", db.display());
                }
                let _ = conn.close().await;
            }
            Err(e) => eprintln!("refresh book in {}: {e}", db.display()),
        }
    }
}

async fn import_archive_inner(
    app: &AppHandle,
    conn: &mut SqliteConnection,
    replace: bool,
) -> Result<ImportedBook, String> {
    let meta = read_archive_meta_attached(conn).await?;
    let book_id = meta
        .get("book_id")
        .cloned()
        .ok_or("archive missing book_id")?;
    let title = meta.get("title").cloned().unwrap_or_default();
    check_schema_version(&meta)?;

    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM books WHERE id = ?1")
        .bind(&book_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| format!("check book: {e}"))?;
    if exists.is_some() && !replace {
        return Err("book already exists".into());
    }

    let storage_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("storage");

    // IMMEDIATE takes the write lock up front so busy_timeout applies to it.
    let mut tx = conn
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| format!("begin: {e}"))?;
    tx.execute("PRAGMA defer_foreign_keys = ON")
        .await
        .map_err(|e| format!("defer fks: {e}"))?;

    if exists.is_some() {
        // FK cascades clear all content (and book_imports -> pipeline_steps).
        sqlx::query("DELETE FROM books WHERE id = ?1")
            .bind(&book_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("delete existing book: {e}"))?;
    }

    insert_book_row(&mut tx, &book_id).await?;
    for table in SEED_CONTENT_TABLES.iter().chain(BOOK_PIPELINE_TABLES) {
        copy_content_table(&mut tx, table).await?;
    }
    extract_seed_assets(&mut tx, &storage_dir).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;

    Ok(ImportedBook { book_id, title })
}

async fn read_archive_meta_attached(
    conn: &mut SqliteConnection,
) -> Result<HashMap<String, String>, String> {
    sqlx::query_as::<_, (String, String)>("SELECT key, value FROM seed._seed_meta")
        .fetch_all(conn)
        .await
        .map(|rows| rows.into_iter().collect())
        .map_err(|_| "not a Branch Fiction book file".to_string())
}

/// Installed extensions get the payload applied now; missing ones get it parked for install time.
async fn apply_extension_payloads(
    app: &AppHandle,
    archive_db: &Path,
    book_id: &str,
) -> Result<(), String> {
    let mut archive = SqliteConnectOptions::from_str(&archive_db.to_string_lossy())
        .map_err(|e| format!("sqlite opts: {e}"))?
        .create_if_missing(false)
        .read_only(true)
        .connect()
        .await
        .map_err(|e| format!("open archive: {e}"))?;

    let has_payloads: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_ext_payloads'",
    )
    .fetch_optional(&mut archive)
    .await
    .map_err(|e| format!("check _ext_payloads: {e}"))?;
    if has_payloads.is_none() {
        let _ = archive.close().await;
        return Ok(());
    }

    let ids: Vec<(String,)> =
        sqlx::query_as("SELECT extension_id FROM _ext_payloads ORDER BY extension_id")
            .fetch_all(&mut archive)
            .await
            .map_err(|e| format!("list payloads: {e}"))?;

    for (ext_id,) in ids {
        let (data,): (Vec<u8>,) =
            sqlx::query_as("SELECT data FROM _ext_payloads WHERE extension_id = ?1")
                .bind(&ext_id)
                .fetch_one(&mut archive)
                .await
                .map_err(|e| format!("read payload {ext_id}: {e}"))?;

        let ext_db = extension_db_file(app, &ext_id)?;
        if ext_db.exists() {
            let payload_path = temp_path(&format!("apply-{}", ext_id.replace('/', "__")));
            std::fs::write(&payload_path, &data)
                .map_err(|e| format!("write payload {ext_id}: {e}"))?;
            let result = apply_payload_to_installed(app, &ext_id, &ext_db, &payload_path).await;
            let _ = std::fs::remove_file(&payload_path);
            if let Err(e) = result {
                eprintln!("extension {ext_id}: payload import failed: {e}");
            }
        } else {
            let dir = pending_payload_dir(app, &ext_id)?;
            std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir pending: {e}"))?;
            std::fs::write(dir.join(format!("{book_id}.db")), &data)
                .map_err(|e| format!("stash payload {ext_id}: {e}"))?;
        }
    }

    let _ = archive.close().await;
    Ok(())
}

async fn apply_payload_to_installed(
    app: &AppHandle,
    ext_id: &str,
    ext_db: &Path,
    payload_path: &Path,
) -> Result<(), String> {
    let mut conn = open_extension_conn(ext_db).await?;
    let result =
        apply_book_payload_file(&mut conn, payload_path, &extension_assets_dir(app, ext_id)?).await;
    let _ = conn.close().await;
    result
}

type TableXinfoRow = (i64, String, String, i64, Option<String>, i64, i64);

// Mirrors insertable_columns in extension_db.rs: skip generated columns (hidden 2/3).
async fn insertable_columns(
    conn: &mut SqliteConnection,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let sql = format!("PRAGMA {schema}table_xinfo(\"{table}\")");
    let rows: Vec<TableXinfoRow> = sqlx::query_as(&sql)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| format!("table_xinfo({schema}{table}): {e}"))?;
    Ok(rows
        .into_iter()
        .filter(|(_, _, _, _, _, _, hidden)| *hidden != 2 && *hidden != 3)
        .map(|(_, name, _, _, _, _, _)| name)
        .collect())
}

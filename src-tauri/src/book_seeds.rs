use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use sqlx::{Connection, Executor, SqliteConnection};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::db_path::open_main_db_rw;
use crate::migrations::MAIN_MIGRATIONS;

/// Keep in sync with SEED_TABLES in scripts/export-seed-book.mjs.
pub(crate) const SEED_CONTENT_TABLES: &[&str] = &[
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
];

#[derive(Serialize)]
pub struct AppliedSeed {
    pub name: String,
    #[serde(rename = "bookId")]
    pub book_id: String,
    pub title: String,
}

/// Copies bundled seed books into the main DB; must run after migrations (frontend loads the DB first).
#[tauri::command]
pub async fn apply_book_seeds(app: AppHandle) -> Result<Vec<AppliedSeed>, String> {
    let dir = app
        .path()
        .resolve("resources/seed-books", BaseDirectory::Resource)
        .map_err(|e| format!("resolve seed-books dir: {e}"))?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| format!("read_dir {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name().is_some_and(|n| {
                let n = n.to_string_lossy();
                n.ends_with(".db") || n.ends_with(".db.gz")
            })
        })
        .collect();
    files.sort();
    if files.is_empty() {
        return Ok(Vec::new());
    }

    let mut conn = open_main_db_rw(&app).await?;
    let has_table: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_seeds'",
    )
    .fetch_optional(&mut conn)
    .await
    .map_err(|e| format!("check book_seeds table: {e}"))?;
    if has_table.is_none() {
        let _ = conn.close().await;
        return Err("book_seeds table missing — migrations have not run yet".into());
    }

    let current_version = MAIN_MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
    let storage_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("storage");
    let mut applied = Vec::new();
    for path in files {
        let name = seed_name(&path);
        let done: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM book_seeds WHERE name = ?1")
            .bind(&name)
            .fetch_optional(&mut conn)
            .await
            .map_err(|e| format!("check seed {name}: {e}"))?;
        if done.is_some() {
            continue;
        }
        let (db_file, is_temp) = match materialize_seed_db(&path) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("skipping book seed {name}: {e}");
                continue;
            }
        };
        let result = apply_seed(&mut conn, &db_file, &name, current_version, &storage_dir).await;
        if is_temp {
            let _ = std::fs::remove_file(&db_file);
        }
        match result {
            Ok(seed) => applied.push(seed),
            Err(e) => eprintln!("skipping book seed {name}: {e}"),
        }
    }
    let _ = conn.close().await;
    Ok(applied)
}

fn seed_name(path: &Path) -> String {
    let fname = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    fname
        .strip_suffix(".db.gz")
        .or_else(|| fname.strip_suffix(".db"))
        .unwrap_or(&fname)
        .to_string()
}

/// Returns a readable .db path; `.gz` seeds are gunzipped to a temp file (true = caller removes it).
pub(crate) fn materialize_seed_db(path: &Path) -> Result<(PathBuf, bool), String> {
    if path.extension().is_none_or(|e| e != "gz") {
        return Ok((path.to_path_buf(), false));
    }
    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut decoder = flate2::read::GzDecoder::new(file);
    let tmp = std::env::temp_dir().join(format!(
        "branch-fiction-seed-{}-{}",
        std::process::id(),
        path.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    ));
    let mut out =
        std::fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
    std::io::copy(&mut decoder, &mut out).map_err(|e| format!("gunzip {}: {e}", path.display()))?;
    Ok((tmp, true))
}

/// Writes `_seed_assets` blobs from the attached `seed` db into `dest_dir`; a failed write rolls the seed back for retry.
pub(crate) async fn extract_seed_assets(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    dest_dir: &Path,
) -> Result<(), String> {
    let exists: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM seed.sqlite_master WHERE type = 'table' AND name = '_seed_assets'",
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("check _seed_assets: {e}"))?;
    if exists.is_none() {
        return Ok(());
    }

    let paths: Vec<(String,)> = sqlx::query_as("SELECT path FROM seed._seed_assets")
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("list seed assets: {e}"))?;

    for (rel,) in paths {
        let rel_path = Path::new(&rel);
        let safe = rel_path.is_relative()
            && rel_path
                .components()
                .all(|c| matches!(c, Component::Normal(_)));
        if !safe {
            eprintln!("skipping seed asset with unsafe path: {rel}");
            continue;
        }
        // One blob in memory at a time.
        let (data,): (Vec<u8>,) =
            sqlx::query_as("SELECT data FROM seed._seed_assets WHERE path = ?1")
                .bind(&rel)
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| format!("read seed asset {rel}: {e}"))?;
        let dest = dest_dir.join(rel_path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir for asset {rel}: {e}"))?;
        }
        std::fs::write(&dest, data).map_err(|e| format!("write asset {rel}: {e}"))?;
    }
    Ok(())
}

async fn apply_seed(
    conn: &mut SqliteConnection,
    path: &Path,
    name: &str,
    current_version: i64,
    storage_dir: &Path,
) -> Result<AppliedSeed, String> {
    let attach_sql = format!(
        "ATTACH DATABASE '{}' AS seed",
        path.to_string_lossy().replace('\'', "''")
    );
    conn.execute(attach_sql.as_str())
        .await
        .map_err(|e| format!("attach seed db: {e}"))?;
    let result = apply_seed_inner(conn, name, current_version, storage_dir).await;
    let _ = conn.execute("DETACH DATABASE seed").await;
    result
}

async fn apply_seed_inner(
    conn: &mut SqliteConnection,
    name: &str,
    current_version: i64,
    storage_dir: &Path,
) -> Result<AppliedSeed, String> {
    let meta: HashMap<String, String> =
        sqlx::query_as::<_, (String, String)>("SELECT key, value FROM seed._seed_meta")
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| format!("read _seed_meta: {e}"))?
            .into_iter()
            .collect();

    let schema_version: i64 = meta
        .get("schema_version")
        .and_then(|v| v.parse().ok())
        .ok_or("missing schema_version in _seed_meta")?;
    let book_id = meta
        .get("book_id")
        .cloned()
        .ok_or("missing book_id in _seed_meta")?;
    let title = meta.get("title").cloned().unwrap_or_default();
    if schema_version > current_version {
        return Err(format!(
            "seed schema v{schema_version} is newer than app schema v{current_version}"
        ));
    }

    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    tx.execute("PRAGMA defer_foreign_keys = ON")
        .await
        .map_err(|e| format!("defer fks: {e}"))?;

    insert_book_row(&mut tx, &book_id).await?;
    for table in SEED_CONTENT_TABLES {
        copy_content_table(&mut tx, table).await?;
    }
    extract_seed_assets(&mut tx, storage_dir).await?;
    sqlx::query("INSERT INTO book_seeds (name, book_id, schema_version) VALUES (?1, ?2, ?3)")
        .bind(name)
        .bind(&book_id)
        .bind(schema_version)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("record seed: {e}"))?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;

    Ok(AppliedSeed {
        name: name.to_string(),
        book_id,
        title,
    })
}

/// Inserts the seed's books row, rewriting unique columns that collide with existing books.
pub(crate) async fn insert_book_row(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    book_id: &str,
) -> Result<(), String> {
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM books WHERE id = ?1")
        .bind(book_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| format!("check existing book: {e}"))?;
    if exists.is_some() {
        return Ok(());
    }

    let cols = shared_columns(tx, "books").await?;
    if cols.is_empty() {
        return Err("seed has no books table".into());
    }
    let col_list = cols
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let exprs = cols
        .iter()
        .map(|c| match c.as_str() {
            "slug" => "CASE WHEN EXISTS (SELECT 1 FROM books b WHERE b.slug = s.slug) \
                       THEN s.slug || '-' || lower(hex(randomblob(3))) ELSE s.slug END"
                .to_string(),
            "share_code" => {
                "CASE WHEN EXISTS (SELECT 1 FROM books b WHERE b.share_code = s.share_code) \
                 THEN lower(hex(randomblob(8))) ELSE s.share_code END"
                    .to_string()
            }
            "isbn" => "CASE WHEN s.isbn IS NOT NULL \
                       AND EXISTS (SELECT 1 FROM books b WHERE b.isbn = s.isbn) \
                       THEN NULL ELSE s.isbn END"
                .to_string(),
            _ => format!("s.\"{c}\""),
        })
        .collect::<Vec<_>>()
        .join(", ");
    let sql =
        format!("INSERT INTO books ({col_list}) SELECT {exprs} FROM seed.books s WHERE s.id = ?1");
    sqlx::query(&sql)
        .bind(book_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert books row: {e}"))?;
    Ok(())
}

pub(crate) async fn copy_content_table(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<(), String> {
    let cols = shared_columns(tx, table).await?;
    if cols.is_empty() {
        return Ok(()); // table absent from this seed
    }
    let col_list = cols
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT OR IGNORE INTO \"{table}\" ({col_list}) SELECT {col_list} FROM seed.\"{table}\""
    );
    sqlx::query(&sql)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("copy {table}: {e}"))?;
    Ok(())
}

type TableXinfoRow = (i64, String, String, i64, Option<String>, i64, i64);

// Mirrors insertable_columns in import_db.rs: skip generated columns (hidden 2/3).
async fn insertable_columns(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let sql = format!("PRAGMA {schema}table_xinfo(\"{table}\")");
    let rows: Vec<TableXinfoRow> = sqlx::query_as(&sql)
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("table_xinfo({schema}{table}): {e}"))?;
    Ok(rows
        .into_iter()
        .filter(|(_, _, _, _, _, _, hidden)| *hidden != 2 && *hidden != 3)
        .map(|(_, name, _, _, _, _, _)| name)
        .collect())
}

/// Columns present in both main and seed copies of a table (seed may predate newer migrations).
async fn shared_columns(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<Vec<String>, String> {
    let seed: HashSet<String> = insertable_columns(tx, "seed.", table)
        .await?
        .into_iter()
        .collect();
    if seed.is_empty() {
        return Ok(Vec::new());
    }
    Ok(insertable_columns(tx, "", table)
        .await?
        .into_iter()
        .filter(|c| seed.contains(c))
        .collect())
}

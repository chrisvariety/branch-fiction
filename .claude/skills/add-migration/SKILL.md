---
name: add-migration
description: Add a SQLite migration. Covers the main app DB (also auto-applied to per-import DBs) and the per-extension DB.
---

# Add a SQLite migration

There are two migration tracks in this codebase. Most of the time you want **(1) main app DB**.

| Track                            | Files                                                                       | When to use                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Main app DB** (`tauri-app.db`) | `src-tauri/migrations/*.sql` + `src-tauri/src/migrations.rs`                | App schema: books, chapters, extensions, providers, etc. **Also auto-applied to per-import DBs** via `import_db.rs:apply_migrations_inner` — no extra work. |
| **Per-extension DB**             | `src-tauri/extension_db_migrations/*.sql` + `src-tauri/src/extension_db.rs` | Schema for the SQLite file each extension worker runs against. Rare.                                                                                        |

## (1) Main app DB migration

This is what you want most of the time.

### Steps

1. **Pick the next version**: look at `ls src-tauri/migrations/` and add 1 to the highest 4-digit prefix.
2. **Create the SQL file**: `src-tauri/migrations/NNNN_<snake_case_description>.sql`. The `<snake_case_description>` becomes the `description` field below — keep them in sync.
3. **Register in `src-tauri/src/migrations.rs`**: append a `MainMigration { ... }` entry to the `MAIN_MIGRATIONS` const array. Order matters — entries run in array order, and the version numbers must be strictly increasing.

   ```rust
   MainMigration {
       version: NN,
       description: "<snake_case_description>",
       sql: include_str!("../migrations/NNNN_<snake_case_description>.sql"),
   },
   ```

4. **Verify**: `cd src-tauri && cargo check && cargo clippy --all-targets` (catches missing files / wrong paths via `include_str!`).

### Conventions

- **Filenames**: `NNNN_<table>_<change>.sql`. Examples: `0014_books_status.sql`, `0018_book_imports_auto_confirm_calibration.sql`.
- **Description string**: matches the filename suffix exactly. Stored in the migrations bookkeeping table; useful when reading `_import_migrations` rows.
- **TypeScript types**: if the change affects a table represented in `src/lib/db/types.ts`, update that file too.
- **Boolean columns**: if the new column stores a boolean (SQLite integers `0`/`1`), add its name to `BOOLEAN_COLUMNS` in `src/lib/db/boolean-plugin.ts` so Kysely returns `true`/`false` instead of `0`/`1`.

### SQLite gotchas

SQLite's `ALTER TABLE` is very limited:

- ✅ `ALTER TABLE t ADD COLUMN c TYPE [DEFAULT ...]`
- ✅ `ALTER TABLE t RENAME COLUMN a TO b` (SQLite 3.25+, fine here)
- ✅ `ALTER TABLE t RENAME TO new_name`
- ✅ `ALTER TABLE t DROP COLUMN c` (SQLite 3.35+, fine here)
- ❌ Can't change a column's type or change `NOT NULL`/default constraints directly.

For unsupported changes, FIRST **confirm with the user** that the **rename-and-rebuild dance** is the right approach, then do it: rename old table → create new table with desired schema → `INSERT INTO new SELECT … FROM old_renamed` → drop old. Inside a single migration file. tauri-plugin-sql wraps each migration in a transaction, and `import_db.rs` wraps the whole batch in `BEGIN…COMMIT`, so partial failures roll back cleanly.

### Idempotency

`tauri-plugin-sql` explicitly states that migrations should be **safe to run multiple times**, so use `IF NOT EXISTS` (and `IF EXISTS` for `DROP`) wherever SQLite supports it:

- ✅ `CREATE TABLE IF NOT EXISTS …`
- ✅ `CREATE INDEX IF NOT EXISTS …`
- ✅ `DROP TABLE IF EXISTS …`
- ✅ `DROP INDEX IF EXISTS …`
- ❌ `ALTER TABLE` statements have no `IF NOT EXISTS` / `IF EXISTS` variants in SQLite — nothing to do there.

Once a migration has shipped to git, never edit it — add a new migration instead.

### What you don't need to touch

- `import_db.rs` — already iterates `MAIN_MIGRATIONS`.
- The `tauri_plugin_migrations()` fn at the bottom of `migrations.rs` — already iterates the const array.
- Any frontend code, unless the schema change requires it (`pnpm run typecheck` will catch type errors like this)

## (2) Per-extension DB migration

The extension DB at `app_data_dir/extension-data/<extension-id>/db.sqlite` runs its own version track. As of writing, only `0001_init.sql` exists and `extension_db.rs:run_migrations_inner` explicitly errors when `current > 0` but no upgrade is registered.

To add `0002`:

1. Create `src-tauri/extension_db_migrations/0002_<description>.sql`.
2. In `src-tauri/src/extension_db.rs`:
   - Bump `EXTENSION_DB_VERSION` to `2`.
   - Add `const EXTENSION_MIGRATION_0002: &str = include_str!("../extension_db_migrations/0002_<description>.sql");`.
   - Replace the placeholder block in `run_migrations_inner` (the one that returns `"no upgrade script registered"`) with real logic that runs each missing script in order based on `current`. The existing comment on that line marks the spot.
3. If the new column stores a boolean, add its name to `BOOLEAN_COLUMNS` in `packages/extension-sdk/src/db/boolean-plugin.ts`.
4. `cd src-tauri && cargo check && cargo clippy --all-targets`.

Extension DBs are per-extension and created lazily on first worker spawn, so a v0 → v2 upgrade has to run both `0001_init.sql` and `0002_*.sql` in sequence on a freshly-created DB. Handle both code paths.

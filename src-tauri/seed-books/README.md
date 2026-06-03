# seed-books

Pre-processed public domain books bundled into the app (mapped to `resources/seed-books` via `tauri.conf.json`).

Each `.db.gz` file is exported from a completed local import:

```sh
pnpm export:seed-book ~/Library/Application\ Support/com.lexikon.branchfiction/book-imports/<id>.db pride-and-prejudice.db
```

It contains the book-content subset of `SHARED_TABLES` (see `src-tauri/src/import_db.rs`), the `books` row, and a `_seed_meta` table recording the schema version at export time. You should commit the generated files as they are pipeline output and not reproducible in CI.

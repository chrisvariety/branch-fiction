#!/usr/bin/env node
// Export a seed DB from a book-import db or an extension db (see usage in parseArgs).

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import Database from 'better-sqlite3';

const APP_IDENTIFIER = 'com.lexikon.branchfiction';
const MAIN_DB_FILENAME = 'branch-fiction.db';
const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SEED_DIR = join(REPO_ROOT, 'src-tauri', 'seed-books');

// Book-content subset of SHARED_TABLES in src-tauri/src/import_db.rs; pipeline bookkeeping excluded.
const SEED_TABLES = [
  'chapters',
  'chapter_paragraphs',
  'chapter_scenes',
  'chapter_scene_groups',
  'chapter_entity_appellations',
  'chapter_entity_attributes',
  'chapter_relationships',
  'book_entities',
  'book_arcs',
  'book_entity_hierarchies',
  'book_categories',
  'book_character_place_scores',
  'book_styles'
];

// Host-managed extension db tables; keep in sync with RESERVED_TABLES in src-tauri/src/extension_db.rs.
const EXTENSION_SKIP = new Set([
  'books',
  'chapters',
  'chapter_paragraphs',
  'book_entities',
  'book_arcs',
  'book_entity_hierarchies',
  'chapter_scenes',
  'chapter_scene_groups',
  'chapter_relationships',
  'chapter_entity_appellations',
  'chapter_entity_attributes',
  'book_categories',
  'book_character_place_scores',
  'book_styles',
  'book_migrations',
  'extension_seeds'
]);

function defaultMainDbPath() {
  switch (process.platform) {
    case 'darwin':
      return join(
        homedir(),
        'Library',
        'Application Support',
        APP_IDENTIFIER,
        MAIN_DB_FILENAME
      );
    case 'win32':
      return join(
        process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
        APP_IDENTIFIER,
        MAIN_DB_FILENAME
      );
    default:
      return join(
        process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
        APP_IDENTIFIER,
        MAIN_DB_FILENAME
      );
  }
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

function usage() {
  fail(
    [
      'usage: node scripts/export-seed-book.mjs <source.db> <output> [--main-db <path>] [--no-assets]',
      '',
      'The source type is auto-detected:',
      '  book-import db  output is a name, e.g. pride-and-prejudice.db -> src-tauri/seed-books/<name>.gz',
      '  extension db    output is a path, e.g. packages/bundled-extensions/chat/seed.db -> <path>.gz',
      '                  the sibling assets/ dir is packed into _seed_assets unless --no-assets'
    ].join('\n')
  );
}

function parseArgs(argv) {
  const positional = [];
  let mainDb = null;
  let includeAssets = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--main-db') {
      mainDb = argv[++i];
      if (!mainDb) fail('--main-db requires a path');
    } else if (argv[i] === '--no-assets') {
      includeAssets = false;
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== 2) usage();
  const [sourcePath, output] = positional;
  return { sourcePath, output, mainDbPath: mainDb ?? defaultMainDbPath(), includeAssets };
}

function openReadonly(path, label) {
  if (!existsSync(path)) fail(`${label} not found: ${path}`);
  return new Database(path, { readonly: true, fileMustExist: true });
}

// Mirrors insertable_columns in import_db.rs: skip generated columns (hidden 2/3).
function insertableColumns(db, table) {
  return db
    .pragma(`table_xinfo("${table}")`)
    .filter((c) => c.hidden !== 2 && c.hidden !== 3)
    .map((c) => c.name);
}

function tableSchema(db, table) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return row?.sql ?? null;
}

function copyTable(src, out, table, transformRow) {
  const schema = tableSchema(src, table);
  if (!schema) {
    console.warn(`warning: table ${table} not found in source, skipping`);
    return 0;
  }
  out.exec(schema);
  const cols = insertableColumns(src, table);
  const insert = out.prepare(
    `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  );
  const rows = src
    .prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${table}"`)
    .all();
  out.transaction(() => {
    for (const row of rows) {
      if (transformRow) transformRow(row);
      insert.run(cols.map((c) => row[c]));
    }
  })();
  return rows.length;
}

function createOutput(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}.gz`, { force: true });
  const out = new Database(dbPath);
  out.pragma('foreign_keys = OFF');
  return out;
}

function writeSeedMeta(out, entries) {
  out.exec('CREATE TABLE _seed_meta (key text PRIMARY KEY, value text NOT NULL)');
  const meta = out.prepare('INSERT INTO _seed_meta (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(entries)) meta.run(key, String(value));
}

function finalize(out, dbPath, counts, detail) {
  out.exec('VACUUM');
  out.close();
  const gzPath = `${dbPath}.gz`;
  writeFileSync(gzPath, gzipSync(readFileSync(dbPath), { level: 9 }));
  rmSync(dbPath);
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table}: ${n} rows`);
  }
  const sizeMb = (statSync(gzPath).size / (1024 * 1024)).toFixed(2);
  console.log(`wrote ${gzPath} (${sizeMb} MB gzipped, ${detail})`);
}

function exportBookSeed(importDb, sourcePath, output, mainDbPath) {
  if (!/^[a-z0-9][a-z0-9-]*\.db$/.test(output)) {
    fail(
      `book seed output must be a kebab-case name ending in .db, e.g. pride-and-prejudice.db (got: ${output})`
    );
  }

  const schemaVersion = importDb
    .prepare('SELECT MAX(version) AS v FROM _import_migrations')
    .get().v;

  const bookIds = importDb
    .prepare('SELECT DISTINCT book_id FROM chapters')
    .all()
    .map((r) => r.book_id);
  if (bookIds.length === 0) fail('no chapters in import db — was the import run?');
  if (bookIds.length > 1)
    fail(`expected one book in import db, found: ${bookIds.join(', ')}`);
  const bookId = bookIds[0];

  const unfinished = importDb
    .prepare(
      "SELECT step_id, status FROM pipeline_steps WHERE status NOT IN ('completed', 'skipped')"
    )
    .all();
  if (unfinished.length > 0) {
    console.warn(
      `warning: import has unfinished pipeline steps: ${unfinished.map((s) => `${s.step_id}(${s.status})`).join(', ')}`
    );
  }

  const mainDb = openReadonly(mainDbPath, 'main db (pass --main-db to override)');
  const bookRow = mainDb.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!bookRow)
    fail(`book ${bookId} not found in main db ${mainDbPath} — did the import complete?`);

  const dbPath = join(SEED_DIR, output);
  const out = createOutput(dbPath);

  const counts = {};
  counts.books = copyTable(mainDb, out, 'books', (row) => {
    row.user_id = 'default';
  });
  // Per-import DBs only ever hold one book, so whole-table copies are safe.
  for (const table of SEED_TABLES) {
    counts[table] = copyTable(importDb, out, table);
  }

  writeSeedMeta(out, {
    schema_version: schemaVersion,
    book_id: bookId,
    slug: bookRow.slug,
    title: bookRow.title,
    source: basename(sourcePath),
    exported_at: new Date().toISOString()
  });

  mainDb.close();
  finalize(out, dbPath, counts, `schema v${schemaVersion}, "${bookRow.title}"`);
}

// Walks dir collecting (relative path, absolute path); skips symlinks and junk files.
function collectAssetFiles(root, dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (lstatSync(abs).isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      collectAssetFiles(root, abs, out);
    } else if (
      entry.isFile() &&
      entry.name !== '.DS_Store' &&
      !entry.name.startsWith('._')
    ) {
      out.push({
        rel: abs
          .slice(root.length + 1)
          .split('\\')
          .join('/'),
        abs
      });
    }
  }
}

function packAssets(out, assetsDir) {
  const files = [];
  collectAssetFiles(assetsDir, assetsDir, files);
  if (files.length === 0) return 0;
  out.exec('CREATE TABLE _seed_assets (path text PRIMARY KEY, data blob NOT NULL)');
  const insert = out.prepare('INSERT INTO _seed_assets (path, data) VALUES (?, ?)');
  let bytes = 0;
  out.transaction(() => {
    for (const f of files) {
      const data = readFileSync(f.abs);
      bytes += data.length;
      insert.run(f.rel, data);
    }
  })();
  console.log(
    `  assets: ${files.length} files (${(bytes / (1024 * 1024)).toFixed(2)} MB)`
  );
  return files.length;
}

function exportExtensionSeed(src, sourcePath, output, includeAssets) {
  if (!output.endsWith('.db')) {
    fail(`extension seed output must be a path ending in .db (got: ${output})`);
  }

  const out = createOutput(output);

  const tables = src
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL")
    .all()
    .map((r) => r.name)
    .filter(
      (t) => !t.startsWith('sqlite_') && !t.startsWith('_') && !EXTENSION_SKIP.has(t)
    );
  if (tables.length === 0) fail('extension db has no extension-owned tables to export');

  const counts = {};
  for (const table of tables) {
    counts[table] = copyTable(src, out, table);
  }

  // apply_manifest_seed copies indexes for seeded tables, so ship them.
  const indexes = src
    .prepare(
      "SELECT sql, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name"
    )
    .all()
    .filter((r) => tables.includes(r.tbl_name));
  for (const { sql } of indexes) out.exec(sql);

  const skipped = src
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('view', 'trigger')")
    .all();
  for (const s of skipped) {
    console.warn(
      `warning: ${s.type} ${s.name} not exported (seeds carry tables and indexes only)`
    );
  }

  let assetCount = 0;
  const assetsDir = join(dirname(sourcePath), 'assets');
  if (includeAssets && existsSync(assetsDir)) {
    assetCount = packAssets(out, assetsDir);
  }

  writeSeedMeta(out, {
    source: basename(sourcePath),
    exported_at: new Date().toISOString()
  });

  finalize(
    out,
    output,
    counts,
    `${tables.length} extension tables, ${assetCount} assets`
  );
}

function main() {
  const { sourcePath, output, mainDbPath, includeAssets } = parseArgs(
    process.argv.slice(2)
  );
  const src = openReadonly(sourcePath, 'source db');
  if (tableSchema(src, '_import_migrations')) {
    exportBookSeed(src, sourcePath, output, mainDbPath);
  } else if (tableSchema(src, 'book_migrations')) {
    exportExtensionSeed(src, sourcePath, output, includeAssets);
  } else {
    fail(
      'source is neither a book-import db (_import_migrations) nor an extension db (book_migrations)'
    );
  }
  src.close();
}

main();

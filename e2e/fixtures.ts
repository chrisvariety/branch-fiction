import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect } from '@playwright/test';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';

import type { ProviderCatalogEntry } from '../src/lib/llm/providers';
import { generateIpcMockScript } from './lib/ipc-mock';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'src-tauri/migrations');
const DEV_URL = 'http://localhost:1420/new-book.html';

const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));

// Mirrors what `read_epub_entries` does on the Rust side: returns a
// { filename: base64-of-bytes } map for every file inside the EPUB zip.
function loadEpubFixture(path: string): Record<string, string> {
  const zip = new AdmZip(path);
  const entries: Record<string, string> = {};
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    entries[entry.entryName] = entry.getData().toString('base64');
  }
  return entries;
}

const MINIMAL_EPUB = loadEpubFixture(join(__dirname, 'fixtures/minimal.epub'));

// One entry from `provider_catalog()` in src-tauri/src/provider_catalog.rs -
// the `openai_compatible` type the test seeds. The frontend loads the catalog
// once at boot; without it loadProviderCatalog() caches null and every catalog
// lookup throws "Provider catalog not loaded". Add more entries here only if a
// test seeds a provider of a different type.
const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    type: 'openai_compatible',
    name: 'OpenAI Compatible',
    baseUrl: '',
    authShape: { kind: 'bearer' },
    piProvider: null,
    apiKeyPlaceholder: 'sk-...',
    envVarPlaceholder: 'OPENAI_API_KEY',
    isCompatibleVariant: true,
    requiresBaseUrl: true
  }
];

declare global {
  interface Window {
    __test_db_select: (sql: string, params: unknown[]) => Promise<unknown[]>;
    __test_db_execute: (
      sql: string,
      params: unknown[]
    ) => Promise<{ changes: number; lastInsertRowid: number }>;
  }
}

const ipcMocks = {
  // App custom commands
  get_http_port: () => 1421,
  get_provider_catalog: () => PROVIDER_CATALOG,
  read_epub_entries: () => MINIMAL_EPUB,
  convert_html_to_markdown: (args: { htmls?: string[] } | undefined) => args?.htmls ?? [],
  test_provider_config: () => ({ ok: true }),
  start_book_import: () => null,
  cancel_book_import: () => null,
  read_model_projection: () => null,
  read_pipeline_step_usages_for_import: () => ({
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costTotal: 0,
    callsWithReasoning: 0,
    callsWithCacheRead: 0
  }),
  list_running_book_imports: async () => {
    const rows = (await window.__test_db_select(
      `SELECT id FROM book_imports WHERE status IN ('pending', 'projection', 'extract', 'arc')`,
      []
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  },
  open_secondary_window: () => null,

  read_selection_entities: async (
    args: { bookId?: string; entityType?: string } | undefined
  ) => {
    const entityType = args?.entityType ?? '';
    let sql = `SELECT id, name, description,
                      significance_tier AS significanceTier,
                      significance_rank AS significanceRank,
                      aliases, pronouns, label, minor_status AS minorStatus
               FROM book_entities WHERE book_id = ? AND type = ?`;
    if (entityType === 'PLACE') sql += ' AND significance_tier IS NOT NULL';
    sql += ' ORDER BY significance_rank ASC, name ASC';
    const rows = (await window.__test_db_select(sql, [
      args?.bookId ?? '',
      entityType
    ])) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      ...r,
      aliases: typeof r.aliases === 'string' ? JSON.parse(r.aliases) : (r.aliases ?? [])
    }));
  },
  update_selection_entities: () => null,

  read_pipeline_steps_for_import: async (args: { bookImportId?: string } | undefined) => {
    const rows = (await window.__test_db_select(
      `SELECT id, book_import_id AS bookImportId, step_id AS stepId,
              fan_out_key AS fanOutKey, status, attempt_count AS attemptCount,
              last_error AS lastError, narrative, logs,
              started_at AS startedAt, completed_at AS completedAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM pipeline_steps WHERE book_import_id = ? ORDER BY rowid`,
      [args?.bookImportId ?? '']
    )) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      ...r,
      narrative: typeof r.narrative === 'string' ? JSON.parse(r.narrative) : r.narrative,
      logs: typeof r.logs === 'string' ? JSON.parse(r.logs) : r.logs
    }));
  },

  // tauri-plugin-sql — bridge to Node-side better-sqlite3 via exposeFunction
  'plugin:sql|load': (args: { db?: string } | undefined) =>
    args?.db ?? 'sqlite:branch-fiction.db',
  'plugin:sql|close': () => true,
  'plugin:sql|select': async (args: { query?: string; values?: unknown[] } | undefined) =>
    window.__test_db_select(args?.query ?? '', args?.values ?? []),
  'plugin:sql|execute': async (
    args: { query?: string; values?: unknown[] } | undefined
  ) => {
    const r = await window.__test_db_execute(args?.query ?? '', args?.values ?? []);
    return [r.changes, r.lastInsertRowid];
  },

  // tauri-plugin-fs — pretend writes succeed, return empty bytes for reads
  'plugin:fs|mkdir': () => null,
  'plugin:fs|write_file': () => null,
  'plugin:fs|write_text_file': () => null,
  'plugin:fs|read_file': () => [],
  'plugin:fs|read_text_file': () => '',

  // tauri-plugin-dialog — file picker returns a fixed path; ask returns true
  'plugin:dialog|open': () => '/fake/home/test-book.epub',
  'plugin:dialog|ask': () => true,
  'plugin:dialog|confirm': () => true,
  'plugin:dialog|message': () => null,

  'plugin:notification|is_permission_granted': () => true,
  'plugin:notification|request_permission': () => 'granted',
  'plugin:notification|notify': () => null,

  'plugin:opener|open_url': () => null,
  'plugin:opener|open_path': () => null,

  'plugin:path|home_dir': () => '/fake/home',
  'plugin:path|app_data_dir': () => '/fake/appdata',
  'plugin:path|app_local_data_dir': () => '/fake/appdata',
  'plugin:path|join': (args: { paths?: string[] } | undefined) =>
    (args?.paths ?? []).join('/'),
  'plugin:path|resolve': (args: { paths?: string[] } | undefined) =>
    (args?.paths ?? []).join('/')
} satisfies Record<string, (args?: Record<string, unknown>) => unknown>;

type Fixtures = {
  db: Database.Database;
};

export const test = base.extend<Fixtures>({
  // oxlint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const sql of MIGRATIONS) db.exec(sql);
    seedDefaults(db);
    await use(db);
    db.close();
  },

  page: async ({ page, db }, use) => {
    await page.exposeFunction('__test_db_select', (sql: string, params: unknown[]) => {
      const stmt = db.prepare(sql);
      if (stmt.reader) return stmt.all(...(params as never[]));
      stmt.run(...(params as never[]));
      return [];
    });
    await page.exposeFunction('__test_db_execute', (sql: string, params: unknown[]) => {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        stmt.all(...(params as never[]));
        return { changes: 0, lastInsertRowid: 0 };
      }
      const r = stmt.run(...(params as never[]));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    });

    // Convenience for poking at the DB from devtools:  await __sql('SELECT ...')
    await page.addInitScript(() => {
      (window as unknown as { __sql: unknown }).__sql = (
        sql: string,
        params: unknown[] = []
      ) =>
        sql.trim().toLowerCase().startsWith('select')
          ? window.__test_db_select(sql, params)
          : window.__test_db_execute(sql, params);
    });

    await page.addInitScript(
      generateIpcMockScript(ipcMocks, { MINIMAL_EPUB, PROVIDER_CATALOG })
    );

    await page.goto(DEV_URL);
    await page.waitForLoadState('networkidle');

    await use(page);
  }
});

function seedDefaults(db: Database.Database) {
  db.prepare(
    `INSERT INTO users (id, name, email, email_verified)
     VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).run('default', 'Test User', 'test@example.com', 1);

  db.prepare(
    `INSERT INTO providers (id, organization_id, name, type, auth_shape, secret_priority)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('p1', 'default', 'Test Provider', 'openai_compatible', '{}', 'key');

  db.prepare(
    `INSERT INTO provider_models (id, provider_id, model_key, display_name)
     VALUES (?, ?, ?, ?)`
  ).run('m1', 'p1', 'gpt-test', 'GPT Test');
}

export { expect };

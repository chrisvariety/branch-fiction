import Database, { type Database as SqliteDB } from 'better-sqlite3';

let cached: { path: string; db: SqliteDB } | null = null;

function open(path: string): SqliteDB {
  if (cached && cached.path === path) return cached.db;
  if (cached) cached.db.close();
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  cached = { path, db };
  return db;
}

export type DbQueryRequest = { sql: string; params?: unknown[] };
export type DbQueryResponse = { rows: Record<string, unknown>[]; changes: number };

export function dbQuery(dbPath: string, req: DbQueryRequest): DbQueryResponse {
  const db = open(dbPath);
  const trimmed = req.sql.trimStart().toLowerCase();
  const isQuery =
    trimmed.startsWith('select') ||
    trimmed.startsWith('with') ||
    trimmed.startsWith('pragma') ||
    trimmed.startsWith('explain');
  const stmt = db.prepare(req.sql);
  if (isQuery) {
    const rows = stmt.all(...(req.params ?? [])) as Record<string, unknown>[];
    return { rows, changes: 0 };
  }
  const info = stmt.run(...(req.params ?? []));
  return { rows: [], changes: Number(info.changes ?? 0) };
}

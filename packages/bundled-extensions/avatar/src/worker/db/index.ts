import { DatabaseSync } from 'node:sqlite';

import { BooleanPlugin } from '@branch-fiction/extension-sdk/db/boolean-plugin';
import { NodeSqliteDialect } from '@branch-fiction/extension-sdk/db/worker';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { SerializePlugin } from 'kysely-plugin-serialize';

import type { Database as DB } from '@/lib/db/types';
import { ensureSchema } from '@/lib/schema';

export function initDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');

  setDb(
    new Kysely<DB>({
      dialect: new NodeSqliteDialect(db),
      plugins: [new CamelCasePlugin(), new BooleanPlugin(), new SerializePlugin()]
    })
  );
}

let _db: Kysely<DB> | null = null;

export function setDb(instance: Kysely<DB>): void {
  _db = instance;
}

export function getDb(): Kysely<DB> {
  if (!_db) {
    throw new Error(
      'DB not initialized — host should call init({ dbPath, ... }) before any handler runs'
    );
  }
  return _db;
}

let dbReady = false;

// Idempotent gate each worker task entry point awaits before its first DB call.
export async function ensureDbReady(): Promise<void> {
  if (dbReady) return;
  initDb(host.dbPath);
  const db = getDb();
  await ensureSchema({
    query: async (stmt) => {
      const result = await sql.raw(stmt).execute(db);
      return { rows: result.rows };
    }
  });
  dbReady = true;
}

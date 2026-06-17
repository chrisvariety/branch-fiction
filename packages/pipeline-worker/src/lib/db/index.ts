import { DatabaseSync } from 'node:sqlite';

import { NodeSqliteDialect } from '@branch-fiction/extension-sdk/db/worker';
import { CamelCasePlugin, Kysely } from 'kysely';
import { SerializePlugin, defaultSerializer } from 'kysely-plugin-serialize';

import { BooleanPlugin } from '@/app/lib/db/boolean-plugin';
import type { Database as DB } from '@/app/lib/db/types';

export function createKyselyDb(dbPath: string): Kysely<DB> {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  // FKs OFF: worker DB references main-DB rows; main enforces FKs at sync time.
  db.exec('PRAGMA foreign_keys = OFF');

  return new Kysely<DB>({
    dialect: new NodeSqliteDialect(db, { beginTransactionSql: 'begin' }),
    plugins: [
      new CamelCasePlugin(),
      new SerializePlugin({
        serializer: (value) =>
          typeof value === 'boolean' ? (value ? 1 : 0) : defaultSerializer(value)
      }),
      new BooleanPlugin()
    ]
  });
}

export function initDb(dbPath: string): void {
  setDb(createKyselyDb(dbPath));
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

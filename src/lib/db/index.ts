import Database from '@tauri-apps/plugin-sql';
import { CamelCasePlugin, CompiledQuery, Kysely } from 'kysely';
import { TauriSqliteDialect } from 'kysely-dialect-tauri';
import { SerializePlugin, defaultSerializer } from 'kysely-plugin-serialize';

import { BooleanPlugin } from './boolean-plugin';
import type { Database as DB } from './types';

const pragma = (sql: string) => CompiledQuery.raw(sql);

const dialect = new TauriSqliteDialect({
  database: async (prefix) => Database.load(`${prefix}branch-fiction.db`),
  onCreateConnection: async (connection) => {
    await connection.executeQuery(pragma('PRAGMA journal_mode = WAL'));
    await connection.executeQuery(pragma('PRAGMA busy_timeout = 5000'));
    await connection.executeQuery(pragma('PRAGMA foreign_keys = ON'));
  }
});

export const db = new Kysely<DB>({
  dialect,
  plugins: [
    new CamelCasePlugin(),
    new SerializePlugin({
      serializer: (value) =>
        typeof value === 'boolean' ? (value ? 1 : 0) : defaultSerializer(value)
    }),
    new BooleanPlugin()
  ]
});

export function getDb() {
  return db;
}

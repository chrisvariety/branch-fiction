import { jsonArrayFrom as jsonArrayFromSqlite } from 'kysely/helpers/sqlite';

export function jsonArrayFrom<O>(expr: Parameters<typeof jsonArrayFromSqlite<O>>[0]) {
  return jsonArrayFromSqlite<O>(expr);
}

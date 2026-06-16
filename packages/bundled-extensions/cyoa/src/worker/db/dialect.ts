import { RawBuilder, sql } from 'kysely';
import {
  jsonArrayFrom as jsonArrayFromSqlite,
  jsonObjectFrom as jsonObjectFromSqlite
} from 'kysely/helpers/sqlite';

import { Point } from '@/lib/db/types';

export function jsonArrayFrom<O>(expr: Parameters<typeof jsonArrayFromSqlite<O>>[0]) {
  return jsonArrayFromSqlite<O>(expr);
}

export function jsonObjectFrom<O>(expr: Parameters<typeof jsonObjectFromSqlite<O>>[0]) {
  return jsonObjectFromSqlite<O>(expr);
}

export function pointArray(points: Point[]): RawBuilder<Point[]> {
  return sql<Point[]>`${JSON.stringify(points)}`;
}

/**
 * JSON-parses nested fields that SerializePlugin misses (jsonObjectFrom/jsonArrayFrom results on SQLite).
 *
 * @example
 *   return parseNestedJsonFields(
 *     { bookInteractiveEntities: ['clickArea', 'headArea', 'bookEntity'] },
 *     result
 *   );
 */
export function parseNestedJsonFields<T>(
  spec: Record<string, readonly string[]>,
  data: T
): T {
  if (data == null || typeof data !== 'object') return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const [fieldKey, innerKeys] of Object.entries(spec)) {
    const field = out[fieldKey];
    if (field == null) continue;
    out[fieldKey] = Array.isArray(field)
      ? field.map((item) => parseInnerKeys(item, innerKeys))
      : parseInnerKeys(field, innerKeys);
  }
  return out as T;
}

function parseInnerKeys(item: unknown, innerKeys: readonly string[]): unknown {
  if (item == null || typeof item !== 'object') return item;
  const copy: Record<string, unknown> = {
    ...(item as Record<string, unknown>)
  };
  for (const key of innerKeys) {
    const val = copy[key];
    if (typeof val === 'string') copy[key] = JSON.parse(val);
  }
  return copy;
}

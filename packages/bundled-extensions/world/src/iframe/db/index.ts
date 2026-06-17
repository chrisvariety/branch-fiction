import { createIframeKysely } from '@branch-fiction/extension-sdk/db/iframe';
import type { Kysely } from 'kysely';

import type { Database, WorldTables } from '@/lib/db/types';

let _db: Kysely<Database> | null = null;

export function getDb(): Kysely<Database> {
  _db ??= createIframeKysely<WorldTables>();
  return _db;
}

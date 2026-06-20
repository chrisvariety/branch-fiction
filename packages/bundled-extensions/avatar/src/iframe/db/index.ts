import { createIframeKysely } from '@branch-fiction/extension-sdk/db/iframe';
import type { Kysely } from 'kysely';

import type { AvatarTables, Database } from '@/lib/db/types';

let _db: Kysely<Database> | null = null;

export function getDb(): Kysely<Database> {
  _db ??= createIframeKysely<AvatarTables>();
  return _db;
}

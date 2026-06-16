import { sql } from 'kysely';

import { getDb } from '@/iframe/db';
import type { UserWorld } from '@/lib/db/types';

export async function updateUserWorldTitleById(
  id: UserWorld['id'],
  title: UserWorld['title']
) {
  return getDb()
    .updateTable('userWorlds')
    .set({ title, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', id)
    .execute();
}

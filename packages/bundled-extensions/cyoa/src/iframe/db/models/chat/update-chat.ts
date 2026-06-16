import { sql } from 'kysely';

import { getDb } from '@/iframe/db';
import type { Chat } from '@/lib/db/types';

export async function updateChatTitleById(id: Chat['id'], title: Chat['title']) {
  return getDb()
    .updateTable('chats')
    .set({ title, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', id)
    .execute();
}

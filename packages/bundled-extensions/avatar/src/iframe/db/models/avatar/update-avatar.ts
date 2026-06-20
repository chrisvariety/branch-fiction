import { sql } from 'kysely';

import { getDb } from '@/iframe/db';

export async function setRunwayAvatarId(
  bookId: string,
  characterId: string,
  runwayAvatarId: string | null
) {
  return getDb()
    .updateTable('avatars')
    .set({ runwayAvatarId, updatedAt: sql`datetime('now')` })
    .where('bookId', '=', bookId)
    .where('characterId', '=', characterId)
    .execute();
}

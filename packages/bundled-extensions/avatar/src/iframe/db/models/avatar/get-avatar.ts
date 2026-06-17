import { getDb } from '@/iframe/db';
import type { Avatar } from '@/lib/db/types';

export async function getAvatar(
  bookId: string,
  characterId: string
): Promise<Avatar | null> {
  const row = await getDb()
    .selectFrom('avatars')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('characterId', '=', characterId)
    .limit(1)
    .executeTakeFirst();
  return row ?? null;
}

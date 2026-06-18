import { getDb } from '@/iframe/db';
import type { AvatarScenario } from '@/lib/db/types';

export async function getScenarios(
  bookId: string,
  characterId: string
): Promise<AvatarScenario[]> {
  return getDb()
    .selectFrom('avatarScenarios')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('characterId', '=', characterId)
    .orderBy('sortOrder', 'asc')
    .execute();
}

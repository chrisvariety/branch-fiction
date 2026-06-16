import { getDb } from '@/iframe/db';

export type CharacterRefDisplay = {
  id: string;
  name: string;
  imageUrl: string | null;
};

export async function getCharacterRefDisplayByBookIdAndCharacterIds(
  bookId: string,
  characterIds: string[]
): Promise<CharacterRefDisplay[]> {
  if (characterIds.length === 0) return [];
  return getDb()
    .selectFrom('bookEntities as be')
    .leftJoin('characterRefs as cr', (join) =>
      join.onRef('cr.characterId', '=', 'be.id').on('cr.bookId', '=', bookId)
    )
    .select(['be.id', 'be.name', 'cr.imageUrl'])
    .where('be.id', 'in', characterIds)
    .execute();
}

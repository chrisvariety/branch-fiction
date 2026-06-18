import { sql } from 'kysely';

import { getDb } from './index';

export interface PickableCharacter {
  id: string;
  name: string;
  identityTag: string | null;
  hasAvatar: boolean;
}

// Only characters with a CHARACTER arc can seed a personality, so gate the picker on it.
export async function getCharacters(bookId: string): Promise<PickableCharacter[]> {
  const rows = await getDb()
    .selectFrom('bookEntities as be')
    .leftJoin('avatars as a', (join) =>
      join.onRef('a.characterId', '=', 'be.id').on('a.bookId', '=', bookId)
    )
    .select(['be.id', 'be.name', 'be.identityTag'])
    .select((eb) => eb.fn.count('a.characterId').as('avatarCount'))
    .where('be.bookId', '=', bookId)
    .where('be.type', '=', 'CHARACTER')
    .where(
      sql<boolean>`EXISTS (
        SELECT 1 FROM book_arcs ba
        WHERE ba.book_id = be.book_id
          AND ba.type = 'CHARACTER'
          AND EXISTS (
            SELECT 1 FROM json_each(ba.book_entity_ids)
            WHERE json_each.value = be.id
          )
      )`
    )
    .groupBy(['be.id', 'be.name', 'be.identityTag'])
    .orderBy('be.significanceRank', 'asc')
    .orderBy('be.name', 'asc')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    identityTag: r.identityTag,
    hasAvatar: Number(r.avatarCount) > 0
  }));
}

import { sql } from 'kysely';

import { getDb } from './index';

export interface PickableEntity {
  id: string;
  name: string;
  identityTag: string | null;
}

// Only entities with a self-contained APPEARANCE_ISOLATED arc can seed a standalone scene.
async function getEntitiesByType(
  bookId: string,
  type: 'CHARACTER' | 'PLACE'
): Promise<PickableEntity[]> {
  return getDb()
    .selectFrom('bookEntities')
    .select(['id', 'name', 'identityTag'])
    .where('bookId', '=', bookId)
    .where('type', '=', type)
    .where(
      sql<boolean>`EXISTS (
        SELECT 1 FROM book_arcs ba
        WHERE ba.book_id = book_entities.book_id
          AND ba.type = 'APPEARANCE_ISOLATED'
          AND EXISTS (
            SELECT 1 FROM json_each(ba.book_entity_ids)
            WHERE json_each.value = book_entities.id
          )
      )`
    )
    .orderBy('significanceRank', 'asc')
    .orderBy('name', 'asc')
    .execute();
}

export function getCharacters(bookId: string): Promise<PickableEntity[]> {
  return getEntitiesByType(bookId, 'CHARACTER');
}

export function getPlaces(bookId: string): Promise<PickableEntity[]> {
  return getEntitiesByType(bookId, 'PLACE');
}

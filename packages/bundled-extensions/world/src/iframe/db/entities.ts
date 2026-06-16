import { getDb } from './index';

export interface PickableEntity {
  id: string;
  name: string;
}

async function getEntitiesByType(
  bookId: string,
  type: 'CHARACTER' | 'PLACE'
): Promise<PickableEntity[]> {
  return getDb()
    .selectFrom('bookEntities')
    .select(['id', 'name'])
    .where('bookId', '=', bookId)
    .where('type', '=', type)
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

import { jsonArrayFrom } from '../../dialect';
import { getDb } from '../../index';

export async function getBookEntityHierarchiesByBookId(bookId: string) {
  return getDb()
    .selectFrom('bookEntityHierarchies')
    .select(['bookEntityId', 'level', 'parentBookEntityId'])
    .where('bookId', '=', bookId)
    .execute();
}

export async function getBookEntityHierarchiesWithEntitiesByBookId(bookId: string) {
  return getDb()
    .selectFrom('bookEntityHierarchies')
    .select(['level', 'parentBookEntityId'])
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('bookEntities')
          .select(['id', 'name', 'identityTag'])
          .whereRef('bookEntities.id', '=', 'bookEntityHierarchies.bookEntityId')
      ).as('bookEntities')
    ])
    .where('bookId', '=', bookId)
    .where('level', '!=', 'REALM')
    .orderBy('significanceRank')
    .execute();
}

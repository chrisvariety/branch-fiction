import { getDb } from '../../index';

export async function getBookEntityHierarchiesByBookId(bookId: string) {
  return getDb()
    .selectFrom('bookEntityHierarchies')
    .select(['bookEntityId', 'level', 'parentBookEntityId'])
    .where('bookId', '=', bookId)
    .execute();
}

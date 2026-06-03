import type { BookEntity } from '../../../../lib/db/types';
import { getDb } from '../../index';

export async function getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
  bookId: BookEntity['bookId'],
  types: BookEntity['type'][],
  significanceTiers: BookEntity['significanceTier'][]
) {
  return getDb()
    .selectFrom('bookEntities')
    .select([
      'id',
      'friendlyId',
      'description',
      'name',
      'names',
      'type',
      'aliases',
      'pronouns',
      'identityTag',
      'label'
    ])
    .where('bookId', '=', bookId)
    .where('type', 'in', types)
    .where('significanceTier', 'in', significanceTiers)
    .orderBy('significanceRank', 'asc')
    .execute();
}

export async function getBookEntitiesForSelection(
  bookId: BookEntity['bookId'],
  type: 'CHARACTER' | 'PLACE'
) {
  let query = getDb()
    .selectFrom('bookEntities')
    .select([
      'id',
      'name',
      'description',
      'significanceTier',
      'significanceRank',
      'aliases',
      'pronouns',
      'label',
      'minorStatus'
    ])
    .where('bookId', '=', bookId)
    .where('type', '=', type);

  // Only HUB/LOCALE places have a significanceTier; non-anchor places are null and excluded.
  if (type === 'PLACE') {
    query = query.where('significanceTier', 'is not', null);
  }

  return query.orderBy('significanceRank', 'asc').orderBy('name', 'asc').execute();
}

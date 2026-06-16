import { getDb } from '@/iframe/db';
import type { BookInteractive } from '@/lib/db/types';

export async function getBookInteractiveEntitiesWithEntityByInteractiveId(
  bookInteractiveId: BookInteractive['id']
) {
  return getDb()
    .selectFrom('bookInteractiveEntities as bie')
    .leftJoin('bookEntities as be', 'be.id', 'bie.bookEntityId')
    .select([
      'bie.id',
      'bie.clickArea',
      'bie.headArea',
      'bie.imageUrl',
      'bie.headImageUrl',
      'bie.bookEntityId',
      'be.name as entityName',
      'be.identityTag as entityIdentityTag',
      'be.significanceRank as entitySignificanceRank'
    ])
    .where('bie.bookInteractiveId', '=', bookInteractiveId)
    .execute();
}

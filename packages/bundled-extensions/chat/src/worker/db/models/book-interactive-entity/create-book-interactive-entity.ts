import type { NewBookInteractiveEntity, Transaction } from '@/lib/db/types';

import { pointArray } from '../../dialect';
import { getDb } from '../../index';

export async function createBookInteractiveEntities(
  bookInteractiveEntities: NewBookInteractiveEntity[],
  trx?: Transaction
) {
  const values = bookInteractiveEntities.map((entity) => ({
    id: entity.id,
    bookId: entity.bookId,
    bookInteractiveId: entity.bookInteractiveId,
    bookEntityId: entity.bookEntityId,
    clickArea: entity.clickArea ? pointArray(entity.clickArea) : null,
    headArea: entity.headArea ? pointArray(entity.headArea) : null,
    imageUrl: entity.imageUrl,
    segmentClass: entity.segmentClass,
    position: entity.position,
    description: entity.description,
    headImageUrl: entity.headImageUrl,
    selectedBookArcId: entity.selectedBookArcId
  }));

  return (trx || getDb())
    .insertInto('bookInteractiveEntities')
    .values(values)
    .returningAll()
    .execute();
}

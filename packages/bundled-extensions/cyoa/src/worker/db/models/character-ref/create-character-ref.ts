import { sql } from 'kysely';

import type { NewCharacterRef, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function upsertCharacterRef(
  ref: NewCharacterRef,
  trx?: Transaction
): Promise<void> {
  await (trx || getDb())
    .insertInto('characterRefs')
    .values(ref)
    .onConflict((oc) =>
      oc.columns(['characterId', 'bookId']).doUpdateSet({
        selectedArcFriendlyId: ref.selectedArcFriendlyId,
        selectedArcId: ref.selectedArcId,
        imageUrl: ref.imageUrl,
        createdAt: sql`CURRENT_TIMESTAMP`
      })
    )
    .execute();
}

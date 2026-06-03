import { sql } from 'kysely';

import type { NewBookEntityExtractionCheckpoint, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function upsertBookEntityExtractionCheckpoint(
  values: NewBookEntityExtractionCheckpoint,
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('bookEntityExtractionCheckpoints')
    .values(values)
    .onConflict((oc) =>
      oc.column('bookId').doUpdateSet({
        schemaVersion: values.schemaVersion,
        entities: values.entities,
        nextEntityId: values.nextEntityId,
        completeChapters: values.completeChapters,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
    )
    .execute();
}

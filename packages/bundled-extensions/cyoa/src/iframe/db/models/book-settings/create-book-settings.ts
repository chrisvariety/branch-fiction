import { sql } from 'kysely';

import { getDb } from '@/iframe/db';
import type { BookSettings } from '@/lib/db/types';

export async function upsertBookSettingsArtStyle(
  bookId: BookSettings['bookId'],
  artStyle: string
): Promise<void> {
  await getDb()
    .insertInto('bookSettings')
    .values({ bookId, artStyle })
    .onConflict((oc) =>
      oc.column('bookId').doUpdateSet({
        artStyle,
        updatedAt: sql`datetime('now')`
      })
    )
    .execute();
}

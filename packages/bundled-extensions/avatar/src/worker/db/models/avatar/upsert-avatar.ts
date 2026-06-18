import { sql } from 'kysely';

import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

interface UpsertAvatarInput {
  characterId: string;
  bookId: string;
  imageUrl: string;
  personality: string;
  artStyle: string;
  selectedArcFriendlyId: string | null;
}

// Re-running prep refreshes the portrait/personality and the freshly-created avatar.
export async function upsertAvatar(
  input: UpsertAvatarInput,
  trx?: Transaction
): Promise<void> {
  await (trx || getDb())
    .insertInto('avatars')
    .values(input)
    .onConflict((oc) =>
      oc.columns(['bookId', 'characterId']).doUpdateSet({
        imageUrl: input.imageUrl,
        personality: input.personality,
        artStyle: input.artStyle,
        selectedArcFriendlyId: input.selectedArcFriendlyId,
        updatedAt: sql`datetime('now')`
      })
    )
    .execute();
}

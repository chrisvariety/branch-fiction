import type { CharacterRef, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getCharacterRefByCharacterIdAndBookId(
  characterId: CharacterRef['characterId'],
  bookId: CharacterRef['bookId'],
  trx?: Transaction
): Promise<CharacterRef | undefined> {
  return (trx || getDb())
    .selectFrom('characterRefs')
    .selectAll()
    .where('characterId', '=', characterId)
    .where('bookId', '=', bookId)
    .executeTakeFirst();
}

export async function getCharacterRefsByBookIdAndCharacterIds(
  bookId: CharacterRef['bookId'],
  characterIds: CharacterRef['characterId'][],
  trx?: Transaction
): Promise<CharacterRef[]> {
  if (characterIds.length === 0) return [];
  return (trx || getDb())
    .selectFrom('characterRefs')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('characterId', 'in', characterIds)
    .execute();
}

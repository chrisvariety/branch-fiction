import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getAvatar(bookId: string, characterId: string, trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('avatars')
    .selectAll()
    .where('bookId', '=', bookId)
    .where('characterId', '=', characterId)
    .limit(1)
    .executeTakeFirst();
}

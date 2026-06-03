import type { NewChatEntity, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createChatEntities(
  chatEntities: NewChatEntity[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('chatEntities')
    .values(chatEntities)
    .returningAll()
    .execute();
}

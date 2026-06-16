import type { NewUserWorld, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createUserWorld(userWorld: NewUserWorld, trx?: Transaction) {
  return (trx || getDb())
    .insertInto('userWorlds')
    .values(userWorld)
    .returning('id')
    .executeTakeFirst();
}

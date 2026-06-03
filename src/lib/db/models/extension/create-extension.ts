import type { NewExtension, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createExtension(extension: NewExtension, trx?: Transaction) {
  return (trx || getDb())
    .insertInto('extensions')
    .values(extension)
    .returningAll()
    .executeTakeFirstOrThrow();
}

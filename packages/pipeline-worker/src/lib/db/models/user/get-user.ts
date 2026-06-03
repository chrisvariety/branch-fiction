import { User, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function getUserById(id: User['id'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('users')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

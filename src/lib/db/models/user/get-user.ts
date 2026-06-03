import { getDb } from '../../index';
import { User, Transaction } from '../../types';

export async function getUserById(id: User['id'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('users')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

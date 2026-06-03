import { sql } from 'kysely';

import type { Transaction, User, UserUpdate } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updateUserById(
  id: User['id'],
  user: UserUpdate,
  trx?: Transaction
) {
  const updatedUser = { ...user };
  if (updatedUser.email) {
    updatedUser.email = updatedUser.email.toLowerCase();
  }

  return (trx || getDb())
    .updateTable('users')
    .set({ ...updatedUser, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', id)
    .execute();
}

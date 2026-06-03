import type { BookEntity, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function deleteBookEntityById(id: BookEntity['id'], trx?: Transaction) {
  return (trx || getDb()).deleteFrom('bookEntities').where('id', '=', id).execute();
}

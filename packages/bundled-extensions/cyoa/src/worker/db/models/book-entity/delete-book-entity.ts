import type { BookEntity } from '@branch-fiction/extension-sdk/db';

import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function deleteBookEntityById(id: BookEntity['id'], trx?: Transaction) {
  return (trx || getDb()).deleteFrom('bookEntities').where('id', '=', id).execute();
}

import type { ChatNodePart, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function deleteChatNodePartsByIds(
  ids: ChatNodePart['id'][],
  trx?: Transaction
) {
  if (ids.length === 0) return;
  await (trx || getDb()).deleteFrom('chatNodeParts').where('id', 'in', ids).execute();
}

import type { BookEntity } from '@branch-fiction/extension-sdk/db';

import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getBookEntityById(id: BookEntity['id'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('bookEntities')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst();
}

export async function getBookEntitiesByIds(ids: BookEntity['id'][], trx?: Transaction) {
  if (ids.length === 0) return [];
  const entities = await (trx || getDb())
    .selectFrom('bookEntities')
    .selectAll()
    .where('id', 'in', ids)
    .execute();
  const byId = new Map(entities.map((e) => [e.id, e]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

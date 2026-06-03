import { getDb } from '../../index';
import type { Transaction } from '../../types';

export async function getExtensionById(id: string, trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('extensions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function listExtensions() {
  return getDb().selectFrom('extensions').selectAll().execute();
}

export async function listEnabledExtensions() {
  return getDb()
    .selectFrom('extensions')
    .selectAll()
    .where('enabled', '=', true)
    .execute();
}

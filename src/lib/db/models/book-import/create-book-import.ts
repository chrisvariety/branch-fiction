import type { NewBookImport } from '@/lib/db/types';

import { getDb } from '../../index';

export async function createBookImport(bookImport: NewBookImport) {
  return getDb()
    .insertInto('bookImports')
    .values(bookImport)
    .returningAll()
    .executeTakeFirst();
}

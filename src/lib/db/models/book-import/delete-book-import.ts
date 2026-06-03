import type { BookImport } from '@/lib/db/types';

import { getDb } from '../../index';

export async function deleteBookImportById(id: BookImport['id']) {
  return getDb().deleteFrom('bookImports').where('id', '=', id).executeTakeFirst();
}

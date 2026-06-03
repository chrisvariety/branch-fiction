import { getDb } from '../../index';
import type { Book } from '../../types';

export async function deleteBookById(id: Book['id']) {
  return getDb().deleteFrom('books').where('id', '=', id).executeTakeFirst();
}

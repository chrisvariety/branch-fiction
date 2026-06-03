import type { BookCategory } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function getBookCategoriesByBookId(bookId: BookCategory['bookId']) {
  return getDb()
    .selectFrom('bookCategories')
    .selectAll()
    .where('bookId', '=', bookId)
    .execute();
}

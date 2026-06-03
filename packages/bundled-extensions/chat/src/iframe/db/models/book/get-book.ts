import type { Book } from '@branch-fiction/extension-sdk/db';

import { getDb } from '@/iframe/db';

export async function getBookSummaryById(id: Book['id']) {
  return getDb()
    .selectFrom('books')
    .select(['id', 'title', 'slug'])
    .where('id', '=', id)
    .executeTakeFirst();
}

import { getDb } from '@/iframe/db';
import type { BookSettings } from '@/lib/db/types';

export async function getBookSettings(
  bookId: BookSettings['bookId']
): Promise<BookSettings | null> {
  const row = await getDb()
    .selectFrom('bookSettings')
    .selectAll()
    .where('bookId', '=', bookId)
    .executeTakeFirst();
  return row ?? null;
}

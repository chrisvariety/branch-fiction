import type { Book } from '@/app/lib/db/types';
import { bridgeGetBook } from '@/lib/bridge';

export async function getBookById(id: Book['id']): Promise<Book | undefined> {
  const row = await bridgeGetBook<Book>(id);
  return row ?? undefined;
}

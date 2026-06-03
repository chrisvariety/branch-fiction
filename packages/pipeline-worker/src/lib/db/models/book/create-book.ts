import type { Book } from '@/app/lib/db/types';
import { bridgeCreateBook } from '@/lib/bridge';

export async function createBook(input: {
  id: string;
  userId: string;
  shareCode: string;
  baseSlug: string;
  title: string;
  isbn: string | null;
  language: string | null;
  publisher: string | null;
  imageUrl: string | null;
}): Promise<Book> {
  return bridgeCreateBook<Book>(input);
}

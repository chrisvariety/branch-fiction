import { queryOptions } from '@tanstack/react-query';

import { getCompletedBooks } from '@/lib/db/models/book/get-book';
import { transformImageUrl } from '@/lib/media/transform-url';

async function fetchBooks() {
  const books = await getCompletedBooks();
  return books.map((book) => ({
    ...book,
    imageUrl: book.imageUrl ? transformImageUrl(book.imageUrl) : null
  }));
}

export const booksQueryOptions = queryOptions({
  queryKey: ['books'],
  queryFn: fetchBooks
});

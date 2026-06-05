import { getDb } from '../../index';
import type { Book } from '../../types';

export async function getBooks() {
  return getDb().selectFrom('books').selectAll().orderBy('title', 'asc').execute();
}

export async function getCompletedBooks() {
  return getDb()
    .selectFrom('books')
    .selectAll('books')
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom('bookSeeds')
            .select('bookSeeds.bookId')
            .whereRef('bookSeeds.bookId', '=', 'books.id')
        )
        .as('isSeed')
    )
    .where('status', '=', 'completed')
    .orderBy('updatedAt', 'desc')
    .execute();
}

export async function getBookById(id: Book['id']) {
  return getDb().selectFrom('books').selectAll().where('id', '=', id).executeTakeFirst();
}

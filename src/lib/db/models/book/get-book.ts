import { getDb } from '../../index';
import type { Book } from '../../types';

export async function getBooks() {
  return getDb().selectFrom('books').selectAll().orderBy('title', 'asc').execute();
}

export async function getCompletedBooks() {
  return getDb()
    .selectFrom('books')
    .selectAll()
    .where('status', '=', 'completed')
    .orderBy('updatedAt', 'desc')
    .execute();
}

export async function getBookById(id: Book['id']) {
  return getDb().selectFrom('books').selectAll().where('id', '=', id).executeTakeFirst();
}

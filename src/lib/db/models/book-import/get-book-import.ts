import type { BookImport } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getBookImportById(id: BookImport['id']) {
  return getDb()
    .selectFrom('bookImports')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

// specifically don't rely on bookImports.status, which can reset
// if user goes in to select characters/places again
export async function getActiveBookImports() {
  return getDb()
    .selectFrom('bookImports')
    .leftJoin('books', 'books.id', 'bookImports.bookId')
    .select([
      'bookImports.id as id',
      'bookImports.bookId as bookId',
      'bookImports.status as status',
      'bookImports.title as title',
      'bookImports.imageUrl as imageUrl'
    ])
    .where('bookImports.status', '!=', 'completed')
    .where((eb) =>
      eb.or([eb('books.status', 'is', null), eb('books.status', '!=', 'completed')])
    )
    .orderBy('bookImports.createdAt', 'desc')
    .execute();
}

export async function getBookImportByBookId(bookId: BookImport['bookId']) {
  return getDb()
    .selectFrom('bookImports')
    .selectAll()
    .where('bookId', '=', bookId)
    .orderBy('createdAt', 'desc')
    .executeTakeFirst();
}

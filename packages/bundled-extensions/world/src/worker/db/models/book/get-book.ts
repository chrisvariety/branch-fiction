import type { Book } from '@branch-fiction/extension-sdk/db';

import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function getBooks() {
  return getDb().selectFrom('books').selectAll().orderBy('title', 'asc').execute();
}

export async function getBookById(id: Book['id']) {
  return getDb().selectFrom('books').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function getBookBySlug(slug: Book['slug'], trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('books')
    .selectAll()
    .where('slug', '=', slug)
    .executeTakeFirst();
}

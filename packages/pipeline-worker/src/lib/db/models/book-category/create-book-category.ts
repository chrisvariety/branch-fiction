import { RawBuilder, sql } from 'kysely';

import type { NewBookCategory, Transaction } from '@/app/lib/db/types';

import { getDb } from '../../index';

export async function createBookCategories(
  bookCategories: NewBookCategory[],
  trx?: Transaction
) {
  return (trx || getDb())
    .insertInto('bookCategories')
    .values(
      bookCategories.map((category) => ({
        ...category,
        examples: category.examples ? json(category.examples) : undefined
      }))
    )
    .returningAll()
    .execute();
}

function json<T>(value: T): RawBuilder<T> {
  return sql`CAST(${JSON.stringify(value)} AS JSONB)`;
}

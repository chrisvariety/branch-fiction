import type { BookStyle } from '@branch-fiction/extension-sdk/db';

import { getDb } from '../../index';

export async function getBookStylesByBookIds(bookIds: BookStyle['bookId'][]) {
  return getDb()
    .selectFrom('bookStyles')
    .selectAll()
    .where('bookId', 'in', bookIds)
    .execute();
}

export async function getBookStylesByBookIdAndIsMajorityOrPovBookEntityId(
  bookId: BookStyle['bookId'],
  povBookEntityId: NonNullable<BookStyle['povBookEntityId']>
) {
  return getDb()
    .selectFrom('bookStyles')
    .select(['id', 'isMajority', 'pov', 'povBookEntityId', 'styleAnalysis'])
    .where('bookId', '=', bookId)
    .where((eb) =>
      eb.or([eb('isMajority', '=', true), eb('povBookEntityId', '=', povBookEntityId)])
    )
    .execute();
}

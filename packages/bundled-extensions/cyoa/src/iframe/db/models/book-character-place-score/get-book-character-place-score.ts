import type { BookCharacterPlaceScore } from '@branch-fiction/extension-sdk/db';

import { getDb } from '@/iframe/db';

export async function getBookCharacterPlaceScoresByBookId(
  bookId: BookCharacterPlaceScore['bookId']
) {
  return getDb()
    .selectFrom('bookCharacterPlaceScores')
    .select(['characterBookEntityId', 'placeBookEntityId', 'score'])
    .where('bookId', '=', bookId)
    .execute();
}

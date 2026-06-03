import type { BookCharacterPlaceScore } from '@branch-fiction/extension-sdk/db';

import { getDb } from '../..';

export async function getTopPlacesForCharacters(
  characterBookEntityIds: BookCharacterPlaceScore['characterBookEntityId'][],
  limit: number = 2
): Promise<{ placeBookEntityId: string; totalScore: number }[]> {
  return getDb()
    .selectFrom('bookCharacterPlaceScores')
    .select(['placeBookEntityId'])
    .select((eb) => eb.fn.sum<number>('score').as('totalScore'))
    .where('characterBookEntityId', 'in', characterBookEntityIds)
    .groupBy('placeBookEntityId')
    .having(
      (eb) => eb.fn.count('characterBookEntityId'),
      '=',
      characterBookEntityIds.length
    )
    .orderBy('totalScore', 'desc')
    .limit(limit)
    .execute();
}

export async function getBookCharacterPlaceScoresByBookId(
  bookId: BookCharacterPlaceScore['bookId']
) {
  return getDb()
    .selectFrom('bookCharacterPlaceScores')
    .selectAll()
    .where('bookId', '=', bookId)
    .execute();
}

import { getDb } from '@/iframe/db';

export async function getPrimaryCastIdsByBookId(
  bookId: string
): Promise<{ characterIds: string[]; placeIds: string[] }> {
  const rows = await getDb()
    .selectFrom('bookEntities')
    .select(['id', 'type'])
    .where('bookId', '=', bookId)
    .where('significanceTier', '=', 'PRIMARY')
    .where('type', 'in', ['CHARACTER', 'PLACE'])
    .orderBy('significanceRank', 'asc')
    .execute();

  const characterIds: string[] = [];
  const placeIds: string[] = [];
  for (const row of rows) {
    if (row.type === 'CHARACTER') characterIds.push(row.id);
    else if (row.type === 'PLACE') placeIds.push(row.id);
  }
  return { characterIds, placeIds };
}

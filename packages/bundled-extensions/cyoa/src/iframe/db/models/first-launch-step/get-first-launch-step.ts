import { getDb } from '@/iframe/db';
import type { FirstLaunchStep } from '@/lib/db/types';

export async function getFirstLaunchStepsByBookId(
  bookId: FirstLaunchStep['bookId']
): Promise<FirstLaunchStep[]> {
  return getDb()
    .selectFrom('firstLaunchSteps')
    .selectAll()
    .where('bookId', '=', bookId)
    .orderBy('createdAt', 'asc')
    .execute();
}

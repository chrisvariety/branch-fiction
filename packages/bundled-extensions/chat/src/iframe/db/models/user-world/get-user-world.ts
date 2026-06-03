import { getDb } from '@/iframe/db';
import type { UserWorld } from '@/lib/db/types';

export async function getUserWorldWithScenariosByUserIdAndSlug(
  userId: UserWorld['userId'],
  slug: UserWorld['slug']
) {
  const world = await getDb()
    .selectFrom('userWorlds')
    .select([
      'id',
      'title',
      'slug',
      'imageUrl',
      'scenarioIds',
      'bookInteractiveEntityIds'
    ])
    .where('userId', '=', userId)
    .where('slug', '=', slug)
    .executeTakeFirst();

  if (!world) return null;

  const scenarios = world.scenarioIds.length
    ? await getDb()
        .selectFrom('scenarios')
        .select(['id', 'title', 'description', 'toneTags'])
        .where('id', 'in', world.scenarioIds)
        .execute()
    : [];

  const entities = world.bookInteractiveEntityIds.length
    ? await getDb()
        .selectFrom('bookInteractiveEntities as bie')
        .innerJoin('bookEntities as be', 'be.id', 'bie.bookEntityId')
        .select(['bie.id', 'be.name', 'bie.headImageUrl'])
        .where('bie.id', 'in', world.bookInteractiveEntityIds)
        .execute()
    : [];

  return { ...world, scenarios, entities };
}

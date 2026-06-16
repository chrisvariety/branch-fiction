import { queryOptions } from '@tanstack/react-query';

import { getChatSlugsByUserIdAndScenarioIds } from '@/iframe/db/models/chat/get-chat';
import { getUserWorldWithScenariosByUserIdAndSlug } from '@/iframe/db/models/user-world/get-user-world';
import { DEFAULT_USER_ID } from '@/lib/auth';
import { transformImageUrl } from '@/lib/media/transform-url';

export type WorldData = {
  id: string;
  title: string;
  imageUrl: string | null;
  largeImageUrl: string | null;
  entities: { id: string; name: string; headImageUrl: string }[];
  scenarios: {
    id: string;
    title: string;
    description: string;
    toneTags: string[];
    chatSlug?: string;
  }[];
};

async function fetchWorld(worldSlug: string): Promise<WorldData> {
  const world = await getUserWorldWithScenariosByUserIdAndSlug(
    DEFAULT_USER_ID,
    worldSlug
  );
  if (!world || world.scenarios.length === 0) throw new Error('World not found');

  const chats = await getChatSlugsByUserIdAndScenarioIds(
    DEFAULT_USER_ID,
    world.scenarios.map((s) => s.id)
  );
  const scenarioIdToChat = new Map(
    chats.map((c) => [c.scenarioId, { slug: c.slug, title: c.title }])
  );

  const entityMap = new Map(world.entities.map((e) => [e.id, e]));
  const sortedEntities = world.bookInteractiveEntityIds.flatMap((id) => {
    const entity = entityMap.get(id);
    if (!entity?.headImageUrl) return [];
    return [
      {
        id: entity.id,
        name: entity.name,
        headImageUrl: transformImageUrl(entity.headImageUrl)
      }
    ];
  });

  return {
    id: world.id,
    title: world.title,
    imageUrl: world.imageUrl ? transformImageUrl(world.imageUrl) : null,
    largeImageUrl: world.imageUrl ? transformImageUrl(world.imageUrl) : null,
    entities: sortedEntities,
    scenarios: world.scenarios.map((scenario) => {
      const chat = scenarioIdToChat.get(scenario.id);
      return {
        id: scenario.id,
        title: chat?.title ?? scenario.title,
        toneTags: scenario.toneTags,
        description: scenario.description,
        chatSlug: chat?.slug
      };
    })
  };
}

export function worldQueryOptions(worldSlug: string) {
  return queryOptions({
    queryKey: ['world', worldSlug] as const,
    queryFn: () => fetchWorld(worldSlug)
  });
}

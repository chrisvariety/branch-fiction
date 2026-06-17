import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import { queryOptions } from '@tanstack/react-query';

import { getLatestChatsByUserId } from '@/iframe/db/models/chat/get-chat';
import { getUserWorldsByUserId } from '@/iframe/db/models/user-world/get-user-world';
import { DEFAULT_USER_ID } from '@/lib/auth';

export type LibraryWorld = {
  id: string;
  title: string;
  slug: string;
  coverImageUrl: string | null;
};

export type LibraryChat = {
  slug: string;
  title: string;
  coverImageUrl: string | null;
};

async function fetchWorlds(): Promise<LibraryWorld[]> {
  const worlds = await getUserWorldsByUserId(DEFAULT_USER_ID);
  return worlds.map((world) => ({
    id: world.id,
    title: world.title,
    slug: world.slug,
    coverImageUrl: world.imageUrl
      ? transformImageUrl(world.imageUrl, { variant: 'thumb' })
      : null
  }));
}

async function fetchLatestChats(limit?: number): Promise<LibraryChat[]> {
  const chats = await getLatestChatsByUserId(DEFAULT_USER_ID, limit);
  return chats.map((chat) => ({
    slug: chat.slug,
    title: chat.title,
    coverImageUrl: chat.coverImageUrl
      ? transformImageUrl(chat.coverImageUrl, { variant: 'thumb' })
      : null
  }));
}

export function worldsQueryOptions() {
  return queryOptions({
    queryKey: ['worlds'] as const,
    queryFn: fetchWorlds
  });
}

export function latestChatsQueryOptions(limit?: number) {
  return queryOptions({
    queryKey: ['latestChats', limit ?? 'all'] as const,
    queryFn: () => fetchLatestChats(limit)
  });
}

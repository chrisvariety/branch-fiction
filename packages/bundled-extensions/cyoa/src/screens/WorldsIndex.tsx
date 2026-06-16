// @ts-ignore
import { BlossomCarousel } from '@blossom-carousel/react';
import { IconArrowRight, IconPlus } from '@tabler/icons-react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { Container } from '@/components/chat/container';
import { ItemCard } from '@/components/chat/item-card';
import {
  latestChatsQueryOptions,
  worldsQueryOptions
} from '@/hooks/queries/library-data';

export function WorldsIndex() {
  const { data: worlds } = useSuspenseQuery(worldsQueryOptions());
  const { data: latestChats } = useSuspenseQuery(latestChatsQueryOptions(10));

  return (
    <Container className="lg:max-w-4xl">
      <div className="flex flex-col pb-4">
        {latestChats.length > 0 && (
          <>
            <div className="px-4 pt-5 pb-3">
              <h2 className="font-sans font-medium md:text-lg">
                Pick up where you left off
              </h2>
            </div>
            <BlossomCarousel className="flex snap-x snap-mandatory overflow-x-auto pb-2">
              {latestChats.map((chat, index) => (
                <div
                  key={chat.slug}
                  className={`w-[85%] flex-none snap-center pr-3 lg:w-[45%] ${index === 0 ? 'ml-4' : ''}`}
                >
                  <ItemCard
                    render={
                      <Link
                        to="/chat/$chatSlug"
                        params={{ chatSlug: chat.slug }}
                        search={{ fromWorld: false }}
                      />
                    }
                    title={chat.title}
                    coverImageUrl={chat.coverImageUrl}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    isContinuing
                  />
                </div>
              ))}
              {latestChats.length >= 10 && (
                <div className="flex h-77 w-12 flex-none snap-center self-stretch lg:h-72.5">
                  <Link
                    to="/chats"
                    className="flex h-full w-full items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <IconArrowRight className="size-5" />
                  </Link>
                </div>
              )}
            </BlossomCarousel>
          </>
        )}

        <div>
          <div className="flex items-center px-4 pt-5 pb-3">
            <h2 className="flex-1 font-sans font-medium md:text-lg">Your Worlds</h2>
            <Link
              to="/create"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <IconPlus className="size-4" />
              Create New
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 px-4 lg:grid-cols-2 lg:pr-0">
            {worlds.map((world) => (
              <ItemCard
                key={world.id}
                render={
                  <Link to="/world/$worldSlug" params={{ worldSlug: world.slug }} />
                }
                title={world.title}
                coverImageUrl={world.coverImageUrl}
              />
            ))}
          </div>
        </div>
      </div>
    </Container>
  );
}

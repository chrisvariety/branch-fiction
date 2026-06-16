import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { Container, HeaderContainer } from '@/components/chat/container';
import { ItemCard } from '@/components/chat/item-card';
import { latestChatsQueryOptions } from '@/hooks/queries/library-data';

export function ChatsIndex() {
  const { data: chats } = useSuspenseQuery(latestChatsQueryOptions());

  return (
    <Container className="lg:max-w-4xl">
      <HeaderContainer>
        <nav className="flex flex-1 items-center gap-1.5 font-sans text-base">
          <Link
            to="/"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Your Worlds
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">Your Stories</span>
        </nav>
      </HeaderContainer>

      <div className="flex flex-col pb-4">
        {chats.length > 0 && (
          <div className="grid grid-cols-1 gap-3 px-4 pt-4 lg:grid-cols-2">
            {chats.map((chat) => (
              <ItemCard
                key={chat.slug}
                render={
                  <Link
                    to="/chat/$chatSlug"
                    params={{ chatSlug: chat.slug }}
                    search={{ fromWorld: false }}
                  />
                }
                title={chat.title}
                coverImageUrl={chat.coverImageUrl}
              />
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}

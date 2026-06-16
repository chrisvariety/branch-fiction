import {
  Outlet,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter
} from '@tanstack/react-router';
import { Suspense } from 'react';

import { BookFlow } from './screens/BookFlow';
import { Chat } from './screens/Chat';
import { ChatsIndex } from './screens/ChatsIndex';
import { InteractivePicker } from './screens/InteractivePicker';
import { World } from './screens/World';

type BookCtx = ExtensionCtx & { bookId: string };

export type RouterContext = {
  ctx: BookCtx;
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRoute
});

function IndexRoute() {
  const { ctx } = indexRoute.useRouteContext();
  return <BookFlow ctx={ctx} />;
}

const chatsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chats',
  component: ChatsIndexRoute
});

function ChatsIndexRoute() {
  return (
    <Suspense fallback={null}>
      <ChatsIndex />
    </Suspense>
  );
}

const createRouteEntry = createRoute({
  getParentRoute: () => rootRoute,
  path: '/create',
  component: CreateRoute
});

function CreateRoute() {
  const { ctx } = createRouteEntry.useRouteContext();
  return (
    <Suspense fallback={null}>
      <InteractivePicker ctx={ctx} />
    </Suspense>
  );
}

const worldRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/world/$worldSlug',
  component: WorldRoute
});

function WorldRoute() {
  const { ctx } = worldRoute.useRouteContext();
  const { worldSlug } = worldRoute.useParams();
  return <World ctx={ctx} worldSlug={worldSlug} />;
}

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$chatSlug',
  validateSearch: (search: Record<string, unknown>): { fromWorld: boolean } => ({
    fromWorld: search.fromWorld === true || search.fromWorld === 'true'
  }),
  component: ChatRoute
});

function ChatRoute() {
  const { ctx } = chatRoute.useRouteContext();
  const { chatSlug } = chatRoute.useParams();
  const { fromWorld } = chatRoute.useSearch();
  return <Chat ctx={ctx} chatSlug={chatSlug} fromWorld={fromWorld} />;
}

const routeTree = rootRoute.addChildren([
  indexRoute,
  chatsIndexRoute,
  createRouteEntry,
  worldRoute,
  chatRoute
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: undefined as unknown as RouterContext
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

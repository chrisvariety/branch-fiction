import {
  Outlet,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter
} from '@tanstack/react-router';

import { BookFlow } from './screens/BookFlow';
import { Chat } from './screens/Chat';
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
  component: ChatRoute
});

function ChatRoute() {
  const { ctx } = chatRoute.useRouteContext();
  const { chatSlug } = chatRoute.useParams();
  return <Chat ctx={ctx} chatSlug={chatSlug} />;
}

const routeTree = rootRoute.addChildren([indexRoute, worldRoute, chatRoute]);

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

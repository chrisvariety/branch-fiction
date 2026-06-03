import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet
} from '@tanstack/react-router';

import { BookPage } from './page';

function BookLayout() {
  return (
    <>
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-50 h-10" />
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <Outlet />
      </main>
    </>
  );
}

const rootRoute = createRootRoute({ component: BookLayout });

const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$bookId',
  component: BookPage
});

const routeTree = rootRoute.addChildren([bookRoute]);

export const bookRouter = createRouter({
  routeTree,
  history: createHashHistory()
});

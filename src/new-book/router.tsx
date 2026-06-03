import {
  createRouter,
  createRootRoute,
  createRoute,
  createHashHistory,
  Outlet
} from '@tanstack/react-router';

import { ImportPage } from './import';
import { UploadPage } from './upload';

function NewBookLayout() {
  return (
    <>
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-50 h-10" />
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <Outlet />
      </main>
    </>
  );
}

const rootRoute = createRootRoute({ component: NewBookLayout });

const uploadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: UploadPage
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$bookImportId',
  component: ImportPage
});

const routeTree = rootRoute.addChildren([uploadRoute, importRoute]);

export const newBookRouter = createRouter({
  routeTree,
  history: createHashHistory()
});

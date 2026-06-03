import { Outlet, createRootRoute } from '@tanstack/react-router';

export const rootRoute = createRootRoute({
  component: () => (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Outlet />
    </div>
  )
});

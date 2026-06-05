import {
  IconCloud,
  IconDatabase,
  IconKey,
  IconPuzzle,
  IconSettings
} from '@tabler/icons-react';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createHashHistory,
  Outlet,
  useRouter,
  useMatches,
  redirect
} from '@tanstack/react-router';

import { useWindowTitle } from '@/hooks/use-window-title';
import { cn } from '@/lib/utils';

import { BackupPage } from './backup';
import { CloudPage } from './cloud';
import { ExtensionsPage } from './extensions';
import { GeneralPage } from './general';
import { ProvidersPage } from './providers';

const tabs = [
  { id: 'general', label: 'General', path: '/general', icon: IconSettings },
  { id: 'providers', label: 'Providers', path: '/providers', icon: IconKey },
  { id: 'extensions', label: 'Extensions', path: '/extensions', icon: IconPuzzle },
  { id: 'cloud', label: 'Cloud', path: '/cloud', icon: IconCloud },
  { id: 'backup', label: 'Backup', path: '/backup', icon: IconDatabase }
] as const;

function SettingsLayout() {
  const router = useRouter();
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.fullPath ?? '/general';

  const activeTab = tabs.find((tab) => currentPath.endsWith(tab.id)) ?? tabs[0];
  useWindowTitle(`Settings — ${activeTab.label}`);

  return (
    <div className="flex h-full overflow-hidden">
      <aside
        data-tauri-drag-region
        className="flex w-48 shrink-0 flex-col border-r border-border bg-muted/40"
      >
        <div className="flex h-10 shrink-0 items-end px-4 pt-12 pb-1 select-none">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Settings
          </span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 py-1">
          {tabs.map((tab) => {
            const isActive = currentPath.endsWith(tab.id);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => router.navigate({ to: tab.path })}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <tab.icon className="size-4 stroke-[1.5]" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div data-tauri-drag-region className="h-8 shrink-0" />
        <main className="flex min-w-0 flex-1 flex-col overflow-auto bg-background px-4 pb-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({ component: SettingsLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/general' });
  }
});

const generalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/general',
  component: GeneralPage
});

const providersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/providers',
  component: ProvidersPage
});

const extensionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/extensions',
  component: ExtensionsPage
});

const cloudRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cloud',
  component: CloudPage
});

const backupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backup',
  component: BackupPage
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  generalRoute,
  providersRoute,
  extensionsRoute,
  cloudRoute,
  backupRoute
]);

export const settingsRouter = createRouter({
  routeTree,
  history: createHashHistory()
});

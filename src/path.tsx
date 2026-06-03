import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createHashHistory,
  createRouter,
  useRouter
} from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';

import { ThemeProvider } from './components/theme-provider';
import { registerExtensionSdkSource } from './extensions/sdk-source';
import { wireCrossWindowInvalidate } from './lib/cross-window-invalidate';
import { loadProviderCatalog } from './lib/llm/providers';
import { bootstrapHttpPort } from './lib/media/transform-url';

import '../index.css';
import { routeTree } from './path-routes/root';

await bootstrapHttpPort();
await loadProviderCatalog();
// Register the iframe SDK source before any iframe requests `/extension-sdk.js`.
await registerExtensionSdkSource();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always', staleTime: 1000 * 60 * 5 },
    mutations: { networkMode: 'always' }
  }
});

wireCrossWindowInvalidate(queryClient);

const router = createRouter({
  routeTree,
  history: createHashHistory()
});

function NavigateOnEvent() {
  const r = useRouter();
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<string>('path:navigate', (e) => {
      void r.navigate({ to: e.payload });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [r]);
  return null;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider
          router={router}
          InnerWrap={({ children }) => (
            <>
              <NavigateOnEvent />
              {children}
            </>
          )}
        />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

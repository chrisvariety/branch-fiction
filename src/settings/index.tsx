import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { wireCrossWindowInvalidate } from '@/lib/cross-window-invalidate';
import { loadProviderCatalog } from '@/lib/llm/providers';
import { bootstrapHttpPort } from '@/lib/media/transform-url';

import { settingsRouter } from './router';

import '../../index.css';

await bootstrapHttpPort();
await loadProviderCatalog();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      staleTime: 1000 * 60 * 5
    },
    mutations: {
      networkMode: 'always'
    }
  }
});

wireCrossWindowInvalidate(queryClient);

function NavigateOnEvent() {
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<string>('settings:navigate', (e) => {
      void settingsRouter.navigate({ to: e.payload });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <NavigateOnEvent />
          <RouterProvider router={settingsRouter} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);

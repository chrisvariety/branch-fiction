import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { registerExtensionSdkSource } from '@/extensions/sdk-source';
import { wireCrossWindowInvalidate } from '@/lib/cross-window-invalidate';
import { loadProviderCatalog } from '@/lib/llm/providers';
import { bootstrapHttpPort } from '@/lib/media/transform-url';

import { bookRouter } from './router';

import '../../index.css';

await bootstrapHttpPort();
await loadProviderCatalog();
await registerExtensionSdkSource();

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
    const unlisten = listen<string>('book:navigate', (e) => {
      void bookRouter.navigate({ to: e.payload });
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
          <RouterProvider router={bookRouter} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);

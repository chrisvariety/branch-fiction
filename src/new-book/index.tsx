import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { wireCrossWindowInvalidate } from '@/lib/cross-window-invalidate';
import { loadSavedModelsCatalog } from '@/lib/llm/models-catalog';
import { loadProviderCatalog } from '@/lib/llm/providers';
import { bootstrapHttpPort } from '@/lib/media/transform-url';

import { newBookRouter } from './router';

import '../../index.css';

await bootstrapHttpPort();
await loadProviderCatalog();
await loadSavedModelsCatalog();

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <RouterProvider router={newBookRouter} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);

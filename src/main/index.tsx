import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { syncBundledExtensions } from '@/extensions/bundled';
import { applyBookSeeds } from '@/lib/book-seeds';
import { wireCrossWindowInvalidate } from '@/lib/cross-window-invalidate';
import { loadSavedModelsCatalog } from '@/lib/llm/models-catalog';
import { loadProviderCatalog } from '@/lib/llm/providers';
import { bootstrapHttpPort } from '@/lib/media/transform-url';

import '../../index.css';
import { BooksPage } from './books';

await bootstrapHttpPort();
await loadProviderCatalog();
await loadSavedModelsCatalog();
await syncBundledExtensions();
await applyBookSeeds();

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
          <BooksPage />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);

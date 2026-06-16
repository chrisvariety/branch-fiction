import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createHashHistory, createRouter } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';

import { ThemeProvider } from './components/theme-provider';
import { registerExtensionSdkSource } from './extensions/sdk-source';
import { wireCrossWindowInvalidate } from './lib/cross-window-invalidate';
import { loadSavedModelsCatalog } from './lib/llm/models-catalog';
import { loadProviderCatalog } from './lib/llm/providers';
import { bootstrapHttpPort } from './lib/media/transform-url';

import '../index.css';
import { routeTree } from './path-routes/root';

await bootstrapHttpPort();
await loadProviderCatalog();
await loadSavedModelsCatalog();
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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

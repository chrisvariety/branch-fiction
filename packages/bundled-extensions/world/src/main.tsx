import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';

import { App } from './App';

import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: false }
  }
});

// No <StrictMode>: its dev double-mount races the Reactor WebRTC handshake.
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);

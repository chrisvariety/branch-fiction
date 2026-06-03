import type { QueryClient } from '@tanstack/react-query';
import { isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

const EVENT = 'query:invalidate';

function selfLabel(): string {
  return getCurrentWindow().label;
}

// Broadcast a "something changed" signal to every webview so each one invalidates its React Query cache.
export async function broadcastInvalidate(): Promise<void> {
  if (!isTauri()) return;
  await emit(EVENT, selfLabel());
}

// Listen for cross-window invalidations and auto-broadcast after every successful mutation.
// Call once per window, right after the QueryClient is constructed.
export function wireCrossWindowInvalidate(queryClient: QueryClient): void {
  if (!isTauri()) return;
  const me = selfLabel();

  void listen<string>(EVENT, (e) => {
    if (e.payload === me) return;
    void queryClient.invalidateQueries();
  });

  queryClient.getMutationCache().subscribe((ev) => {
    if (ev?.type === 'updated' && ev.mutation.state.status === 'success') {
      void broadcastInvalidate();
    }
  });
}

import type { Page } from '@playwright/test';

import './ipc-mock';

export async function emitMockEvent(
  page: Page,
  event: string,
  payload: unknown
): Promise<void> {
  await page.evaluate(
    ({ event, payload }) => window.__TAURI_EMIT_MOCK_EVENT__(event, payload),
    { event, payload }
  );
}

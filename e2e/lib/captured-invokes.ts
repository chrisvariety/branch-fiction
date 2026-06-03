import type { Page } from '@playwright/test';

import type { CapturedInvoke } from './ipc-mock';

export async function getCapturedInvokes(page: Page): Promise<CapturedInvoke[]> {
  return page.evaluate(() => window.__TAURI_GET_MOCK_CALLS__());
}

export async function clearCapturedInvokes(page: Page): Promise<void> {
  await page.evaluate(() => window.__TAURI_CLEAR_MOCK_CALLS__());
}

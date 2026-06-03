import { invoke } from '@tauri-apps/api/core';

export async function startImport(
  bookImportId: string,
  options?: { retryFailed?: boolean }
): Promise<void> {
  await invoke('start_book_import', {
    bookImportId,
    retryFailed: options?.retryFailed ?? false
  });
}

export async function cancelImport(bookImportId: string): Promise<void> {
  await invoke('cancel_book_import', { bookImportId });
}

export async function recheckMinor(
  bookImportId: string,
  bookId: string,
  bookEntityId: string
): Promise<void> {
  await invoke('recheck_book_entity_minor', { bookImportId, bookId, bookEntityId });
}

// Aliases preserved so existing callers don't have to change shape.
export const advanceImport = (bookImportId: string) => startImport(bookImportId);
export const resumeImport = (bookImportId: string) =>
  startImport(bookImportId, { retryFailed: true });

export async function listRunningImports(): Promise<string[]> {
  return invoke<string[]>('list_running_book_imports');
}

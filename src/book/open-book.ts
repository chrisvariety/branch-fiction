import { invoke } from '@tauri-apps/api/core';

export async function openBookWindow(bookId: string): Promise<void> {
  await invoke('open_book_window', {
    bookId,
    dark: document.documentElement.classList.contains('dark')
  });
}

import { invoke } from '@tauri-apps/api/core';

export type OpenPathArgs = {
  extensionId: string;
  bookId: string;
};

export async function openExtensionPath(args: OpenPathArgs): Promise<void> {
  await invoke('open_path_window', {
    extensionId: args.extensionId,
    bookId: args.bookId,
    dark: document.documentElement.classList.contains('dark')
  });
}

export async function closeExtensionPath(extensionId: string): Promise<void> {
  await invoke('close_path_window', { extensionId });
}

import { BaseDirectory, exists } from '@tauri-apps/plugin-fs';

export function importDbExists(bookImportId: string): Promise<boolean> {
  return exists(`book-imports/${bookImportId}.db`, { baseDir: BaseDirectory.AppData });
}

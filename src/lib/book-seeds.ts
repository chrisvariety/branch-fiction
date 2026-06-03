import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';

export interface AppliedSeed {
  name: string;
  bookId: string;
  title: string;
}

export async function applyBookSeeds(): Promise<AppliedSeed[]> {
  try {
    // Loading the DB runs pending migrations, which the seeder requires.
    await Database.load('sqlite:branch-fiction.db');
    return await invoke<AppliedSeed[]>('apply_book_seeds');
  } catch (err) {
    console.error('Failed to apply book seeds:', err);
    return [];
  }
}

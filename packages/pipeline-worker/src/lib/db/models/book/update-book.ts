import type { BookUpdate } from '@/app/lib/db/types';
import { bridgeUpdateBook } from '@/lib/bridge';

export async function updateBookById(id: string, fields: BookUpdate) {
  await bridgeUpdateBook(id, fields as unknown as Record<string, unknown>);
}

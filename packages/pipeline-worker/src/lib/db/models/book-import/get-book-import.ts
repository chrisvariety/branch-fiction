import type { BookImport } from '@/app/lib/db/types';
import { bridgeGetBookImport } from '@/lib/bridge';

export async function getBookImportById(
  _id: BookImport['id']
): Promise<BookImport | undefined> {
  // The bridge is bound to this import's session token, so id is implicit.
  const row = await bridgeGetBookImport<BookImport>();
  return row ?? undefined;
}

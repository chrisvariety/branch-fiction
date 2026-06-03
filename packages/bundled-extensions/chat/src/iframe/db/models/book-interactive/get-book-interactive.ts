import { getDb } from '@/iframe/db';
import type { BookInteractive } from '@/lib/db/types';

const CHARACTER_TYPES = [
  'CHARACTER_SIMPLE',
  'CHARACTER_HORIZONTAL',
  'CHARACTER_VERTICAL'
] as const satisfies readonly BookInteractive['type'][];

const PLACE_TYPES = [
  'PLACE_SIMPLE',
  'PLACE_HORIZONTAL',
  'PLACE_VERTICAL'
] as const satisfies readonly BookInteractive['type'][];

export async function getActiveBookInteractiveByBookIdAndKind(
  bookId: BookInteractive['bookId'],
  kind: 'character' | 'place'
) {
  const typeFilter = kind === 'character' ? CHARACTER_TYPES : PLACE_TYPES;
  return getDb()
    .selectFrom('bookInteractives')
    .select(['id', 'url', 'videoUrl', 'width', 'height'])
    .where('bookId', '=', bookId)
    .where('status', '=', 'active')
    .where('type', 'in', typeFilter)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst();
}

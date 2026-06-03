import { getBookEntitiesByBookIdAndTypesAndSignificanceTiers } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getChapterSceneGroupsByBookId } from '@/lib/db/models/chapter-scene-group/get-chapter-scene-group';

import type { PipelineContext } from './types';

type EnumeratorResult = { key: string; payload: Record<string, unknown> };

type Enumerator = (
  ctx: PipelineContext,
  basePayload: Record<string, unknown>
) => Promise<EnumeratorResult[]>;

async function getBookIdFromContext(ctx: PipelineContext): Promise<string> {
  if (ctx.bookId) return ctx.bookId;
  const bookImport = await getBookImportById(ctx.bookImportId);
  if (!bookImport?.bookId) throw new Error('Book ID not found for import');
  return bookImport.bookId;
}

const sceneGroups: Enumerator = async (ctx, basePayload) => {
  const bookId = await getBookIdFromContext(ctx);
  const groups = await getChapterSceneGroupsByBookId(bookId);
  return groups.map((g) => ({
    key: g.id,
    payload: { ...basePayload, sceneGroupId: g.id }
  }));
};

const characterEntities: Enumerator = async (ctx, basePayload) => {
  const bookId = await getBookIdFromContext(ctx);
  const entities = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
    bookId,
    ['CHARACTER'],
    ['PRIMARY']
  );
  return entities.map((e) => ({
    key: e.id,
    payload: { ...basePayload, bookEntityId: e.id }
  }));
};

const placeEntities: Enumerator = async (ctx, basePayload) => {
  const bookId = await getBookIdFromContext(ctx);
  const entities = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
    bookId,
    ['PLACE'],
    ['PRIMARY']
  );
  return entities.map((e) => ({
    key: e.id,
    payload: { ...basePayload, bookEntityId: e.id }
  }));
};

const enumerators: Record<string, Enumerator> = {
  'scene-groups': sceneGroups,
  'character-entities': characterEntities,
  'place-entities': placeEntities
};

export function getEnumerator(name: string): Enumerator {
  const enumerator = enumerators[name];
  if (!enumerator) throw new Error(`Unknown enumerator: ${name}`);
  return enumerator;
}

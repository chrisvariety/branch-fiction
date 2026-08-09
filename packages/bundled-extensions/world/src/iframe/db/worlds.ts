import type { ActiveWorld, OysterModel } from '@/lib/db/types';

import { getDb } from './index';

export interface SavedWorld extends ActiveWorld {
  model: OysterModel;
  encryptedWorldId: string;
  characterName: string | null;
  placeName: string | null;
  createdAt: string;
}

const OYSTER_MODELS: OysterModel[] = ['oyster-adventure', 'oyster-directing'];

// Only HappyOyster worlds persist server-side
export async function getSavedOysterWorlds(bookId: string): Promise<SavedWorld[]> {
  const rows = await getDb()
    .selectFrom('worlds')
    .leftJoin('bookEntities as character', 'character.id', 'worlds.characterEntityId')
    .leftJoin('bookEntities as place', 'place.id', 'worlds.placeEntityId')
    .select([
      'worlds.id as worldId',
      'worlds.model as model',
      'worlds.prompt as prompt',
      'worlds.seedImageUrl as seedImageUrl',
      'worlds.suggestedActions as suggestedActions',
      'worlds.encryptedWorldId as encryptedWorldId',
      'character.name as characterName',
      'place.name as placeName',
      'worlds.createdAt as createdAt'
    ])
    .where('worlds.bookId', '=', bookId)
    .where('worlds.model', 'in', OYSTER_MODELS)
    .where('worlds.encryptedWorldId', 'is not', null)
    .orderBy('worlds.createdAt', 'desc')
    .execute();

  return rows.map((row) => ({
    ...row,
    suggestedActions: row.suggestedActions ?? []
  })) as SavedWorld[];
}

export async function saveEncryptedWorldId(
  worldId: string,
  encryptedWorldId: string
): Promise<void> {
  await getDb()
    .updateTable('worlds')
    .set({ encryptedWorldId })
    .where('id', '=', worldId)
    .execute();
}

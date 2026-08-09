import type { SeededDatabase } from '@branch-fiction/extension-sdk/db';
import type {
  Generated,
  Insertable,
  Selectable,
  Updateable,
  Transaction as KyselyTransaction
} from 'kysely';

export type WorldModel = 'helios' | 'lingbot' | 'oyster-adventure' | 'oyster-directing';

export type OysterModel = Extract<WorldModel, 'oyster-adventure' | 'oyster-directing'>;

// extension-owned tables follow

export interface WorldsTable {
  id: string;
  bookId: string;
  characterEntityId: string;
  placeEntityId: string;
  model: WorldModel;
  prompt: string;
  seedImageUrl: string;
  suggestedActions: string[] | null;
  // Happy Oyster only
  encryptedWorldId: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface ActiveWorld {
  worldId: string;
  model: WorldModel;
  prompt: string;
  seedImageUrl: string;
  suggestedActions: string[];
  encryptedWorldId: string | null;
}

export type World = Selectable<WorldsTable>;
export type NewWorld = Insertable<WorldsTable>;
export type WorldUpdate = Updateable<WorldsTable>;

export interface WorldTables {
  worlds: WorldsTable;
}

export type Database = SeededDatabase & WorldTables;

export type Transaction = KyselyTransaction<Database>;

import type { SeededDatabase } from '@branch-fiction/extension-sdk/db';
import type {
  Generated,
  Insertable,
  Selectable,
  Updateable,
  Transaction as KyselyTransaction
} from 'kysely';

// extension-owned tables follow

export interface AvatarsTable {
  characterId: string;
  bookId: string;
  imageUrl: string;
  personality: string;
  artStyle: string | null;
  selectedArcFriendlyId: string | null;
  runwayAvatarId: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type Avatar = Selectable<AvatarsTable>;
export type NewAvatar = Insertable<AvatarsTable>;
export type AvatarUpdate = Updateable<AvatarsTable>;

export interface AvatarScenariosTable {
  id: string;
  bookId: string;
  characterId: string;
  scenarioKey: string;
  mode: string;
  label: string;
  tagline: string;
  startScript: string;
  personality: string;
  knowledge: string;
  knowledgeHash: string;
  anchorChapterIdx: number | null;
  runwayDocumentId: string | null;
  runwayDocumentHash: string | null;
  sortOrder: Generated<number>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type AvatarScenario = Selectable<AvatarScenariosTable>;
export type NewAvatarScenario = Insertable<AvatarScenariosTable>;
export type AvatarScenarioUpdate = Updateable<AvatarScenariosTable>;

export interface AvatarTables {
  avatars: AvatarsTable;
  avatarScenarios: AvatarScenariosTable;
}

export type Database = SeededDatabase & AvatarTables;

export type Transaction = KyselyTransaction<Database>;

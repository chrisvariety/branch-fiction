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
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type Avatar = Selectable<AvatarsTable>;
export type NewAvatar = Insertable<AvatarsTable>;
export type AvatarUpdate = Updateable<AvatarsTable>;

export interface AvatarTables {
  avatars: AvatarsTable;
}

export type Database = SeededDatabase & AvatarTables;

export type Transaction = KyselyTransaction<Database>;

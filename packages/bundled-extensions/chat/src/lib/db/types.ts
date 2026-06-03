import type { SeededDatabase } from '@branch-fiction/extension-sdk/db';
import type {
  Generated,
  Insertable,
  Selectable,
  Updateable,
  Transaction as KyselyTransaction
} from 'kysely';

// extension-owned tables follow

export type FirstLaunchStepId =
  | 'character_reference_image'
  | 'character_interactive_generate'
  | 'character_interactive_finalize'
  | 'place_interactive_generate'
  | 'place_interactive_finalize';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

type CharacterInteractiveType =
  | 'CHARACTER_HORIZONTAL'
  | 'CHARACTER_VERTICAL'
  | 'CHARACTER_SIMPLE';
type PlaceInteractiveType = 'PLACE_HORIZONTAL' | 'PLACE_VERTICAL' | 'PLACE_SIMPLE';

export interface LogLine {
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface FirstLaunchStepsTable {
  id: string;
  bookId: string;
  stepId: FirstLaunchStepId;
  fanOutKey: string | null;
  attemptCount: Generated<number>;
  lastError: string | null;
  logs: Generated<LogLine[]>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type FirstLaunchStep = Selectable<FirstLaunchStepsTable>;
export type NewFirstLaunchStep = Insertable<FirstLaunchStepsTable>;
export type FirstLaunchStepUpdate = Updateable<FirstLaunchStepsTable>;

export interface CharacterRefsTable {
  characterId: string;
  bookId: string;
  selectedArcFriendlyId: string;
  selectedArcId: string;
  imageUrl: string;
  createdAt: Generated<string>;
}

export type CharacterRef = Selectable<CharacterRefsTable>;
export type NewCharacterRef = Insertable<CharacterRefsTable>;
export type CharacterRefUpdate = Updateable<CharacterRefsTable>;

export interface BookSettingsTable {
  bookId: string;
  artStyle: string | null;
  characterInteractiveType: CharacterInteractiveType | null;
  placeInteractiveType: PlaceInteractiveType | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookSettings = Selectable<BookSettingsTable>;
export type NewBookSettings = Insertable<BookSettingsTable>;
export type BookSettingsUpdate = Updateable<BookSettingsTable>;

export interface Point {
  x: number;
  y: number;
}

export interface InteractiveEntityPosition {
  name: string;
  description: string;
  segmentClass: string;
}

export interface BookInteractivesTable {
  id: Generated<string>;
  bookId: string;
  type: CharacterInteractiveType | PlaceInteractiveType;
  url: string | null;
  width: number | null;
  height: number | null;
  videoUrl: string | null;
  status: 'draft' | 'active' | 'archived';
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookInteractive = Selectable<BookInteractivesTable>;
export type NewBookInteractive = Insertable<BookInteractivesTable>;
export type BookInteractiveUpdate = Updateable<BookInteractivesTable>;

export interface BookInteractiveEntitiesTable {
  id: Generated<string>;
  bookId: string;
  bookInteractiveId: string;
  bookEntityId: string;
  selectedBookArcId: string;
  clickArea: Point[] | null;
  headArea: Point[] | null;
  imageUrl: string | null;
  segmentClass: string;
  position: string | null;
  description: string | null;
  headImageUrl: string | null;
  croppedImageUrl: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookInteractiveEntity = Selectable<BookInteractiveEntitiesTable>;
export type NewBookInteractiveEntity = Insertable<BookInteractiveEntitiesTable>;
export type BookInteractiveEntityUpdate = Updateable<BookInteractiveEntitiesTable>;

export interface UserWorldsTable {
  id: string;
  title: string;
  slug: string;
  userId: string;
  scenarioIds: Generated<string[]>;
  bookInteractiveEntityIds: Generated<string[]>;
  bookIds: Generated<string[]>;
  accessType: 'public' | 'demo' | 'preview' | null;
  imageUrl: string | null;
  artStyle: string | null;
  characterInteractiveType: Generated<CharacterInteractiveType>;
  placeInteractiveType: Generated<PlaceInteractiveType>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type UserWorld = Selectable<UserWorldsTable>;
export type NewUserWorld = Insertable<UserWorldsTable>;
export type UserWorldUpdate = Updateable<UserWorldsTable>;

export interface ScenariosTable {
  id: string;
  bookId: string;
  relationshipBookArcId: string | null;
  title: string;
  description: string;
  toneTags: Generated<string[]>;
  appellationBookArcIds: Generated<string[]>;
  additionalBookEntityIds: Generated<string[]>;
  friendlyIdPrefix: Generated<string>;
  friendlyIdIdx: Generated<number>;
  friendlyId: Generated<string>;
  characterInteractiveType: Generated<CharacterInteractiveType>;
  placeInteractiveType: Generated<PlaceInteractiveType>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type Scenario = Selectable<ScenariosTable>;
export type NewScenario = Insertable<ScenariosTable>;
export type ScenarioUpdate = Updateable<ScenariosTable>;

export interface ScenarioEntitiesTable {
  id: string;
  idx: number;
  scenarioId: string;
  bookId: string;
  bookEntityId: string;
  bookArcId: string;
  appearanceBookArcId: string | null;
  imageUrl: string | null;
  description: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ScenarioEntity = Selectable<ScenarioEntitiesTable>;
export type NewScenarioEntity = Insertable<ScenarioEntitiesTable>;
export type ScenarioEntityUpdate = Updateable<ScenarioEntitiesTable>;

export interface ChatsTable {
  id: string;
  title: string;
  slug: string;
  userId: string;
  organizationId: string | null;
  relationshipBookArcId: string | null;
  scenarioId: string | null;
  toneTags: Generated<string[]>;
  appellationBookArcIds: Generated<string[]>;
  additionalBookEntityIds: Generated<string[]>;
  accessType: 'public' | 'demo' | 'preview' | null;
  artStyle: string | null;
  currentLeafNodeId: string | null;
  userWorldId: string | null;
  bookIds: Generated<string[]>;
  systemPrompt: string;
  imageMode: Generated<'eager' | 'occasional'>;
  initialImageModel: string | null;
  currentImageModel: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type Chat = Selectable<ChatsTable>;
export type NewChat = Insertable<ChatsTable>;
export type ChatUpdate = Updateable<ChatsTable>;

export interface ChatEntitiesTable {
  id: string;
  idx: number;
  chatId: string;
  bookId: string;
  bookEntityId: string;
  bookArcId: string;
  modifier: string | null;
  appearanceBookArcId: string | null;
  imageUrl: string | null;
  description: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChatEntity = Selectable<ChatEntitiesTable>;
export type NewChatEntity = Insertable<ChatEntitiesTable>;
export type ChatEntityUpdate = Updateable<ChatEntitiesTable>;

export interface ChatNodesTable {
  id: string;
  chatId: string;
  parentNodeId: string | null;
  actionLabel: string;
  actionType: string;
  systemInstruction: string | null;
  depth: Generated<number>;
  childrenCount: Generated<number>;
  shouldGenerateVisual: Generated<boolean>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChatNode = Selectable<ChatNodesTable>;
export type NewChatNode = Insertable<ChatNodesTable>;
export type ChatNodeUpdate = Updateable<ChatNodesTable>;

export interface ChatNodePartsTable {
  id: string;
  chatNodeId: string;
  type: 'CONTENT' | 'VISUAL' | 'ACTION' | 'INTERNAL_CONTENT';
  idx: number;
  content: string;
  contentUrl: string | null;
  subtype:
    | 'image'
    | 'video'
    | 'none'
    | 'entity_mention'
    | 'entering_characters'
    | 'entering_entities'
    | 'explicit_sexual_content'
    | 'skipped_image'
    | 'kickoff'
    | null;
  toolCall: { id?: string; name: string; args: Record<string, unknown> } | null;
  bookEntityIds: Generated<string[]>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChatNodePart = Selectable<ChatNodePartsTable>;
export type NewChatNodePart = Insertable<ChatNodePartsTable>;
export type ChatNodePartUpdate = Updateable<ChatNodePartsTable>;

export interface ChatTables {
  firstLaunchSteps: FirstLaunchStepsTable;
  characterRefs: CharacterRefsTable;
  bookSettings: BookSettingsTable;
  bookInteractives: BookInteractivesTable;
  bookInteractiveEntities: BookInteractiveEntitiesTable;
  userWorlds: UserWorldsTable;
  scenarios: ScenariosTable;
  scenarioEntities: ScenarioEntitiesTable;
  chats: ChatsTable;
  chatEntities: ChatEntitiesTable;
  chatNodes: ChatNodesTable;
  chatNodeParts: ChatNodePartsTable;
}

export type Database = SeededDatabase & ChatTables;

export type Transaction = KyselyTransaction<Database>;

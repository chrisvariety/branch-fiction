import type {
  Generated,
  Insertable,
  Selectable,
  Updateable,
  Transaction as KyselyTransaction
} from 'kysely';

export type Transaction = KyselyTransaction<Database>;

// SQLite: UUIDs/timestamps as text, booleans as 0/1 (BooleanPlugin), objects as JSON (ParseJSONResultsPlugin).

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface UsersTable {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  externalId: string | null;
  isAnonymous: boolean | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

export interface BooksTable {
  id: string;
  shareCode: string;
  userId: string;
  title: string;
  slug: string;
  isbn: string | null;
  language: string | null;
  publisher: string | null;
  characterRankType: 'ENSEMBLE' | 'EPISODIC' | null;
  imageUrl: string | null;
  status: 'completed' | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type Book = Selectable<BooksTable>;
export type NewBook = Insertable<BooksTable>;
export type BookUpdate = Updateable<BooksTable>;

export interface BookSeedsTable {
  name: string;
  bookId: string;
  schemaVersion: number;
  appliedAt: Generated<string>;
}

export type BookSeed = Selectable<BookSeedsTable>;

export interface ChaptersTable {
  id: string;
  idx: number;
  href: string;
  bookId: string;
  title: string;
  summary: string | null;
  endSummary: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type Chapter = Selectable<ChaptersTable>;
export type NewChapter = Insertable<ChaptersTable>;
export type ChapterUpdate = Updateable<ChaptersTable>;

export interface ChapterParagraphsTable {
  id: string;
  bookId: string;
  chapterId: string;
  chapterIdx: number;
  paragraphIdx: number;
  bookParagraphIdx: number;
  content: string;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChapterParagraph = Selectable<ChapterParagraphsTable>;
export type NewChapterParagraph = Insertable<ChapterParagraphsTable>;
export type ChapterParagraphUpdate = Updateable<ChapterParagraphsTable>;

export interface ChapterScenesTable {
  id: string;
  chapterId: string;
  bookId: string;
  startChapterParagraphId: string;
  endChapterParagraphId: string;
  povBookEntityId: string | null;
  pov:
    | 'first-person'
    | 'second-person'
    | 'third-person limited'
    | 'third-person omniscient';
  title: string;
  isPreliminary: Generated<boolean>;
  povEntity: string;
  location: string | null;
  setting: string | null;
  locationBookEntityId: string | null;
  settingBookEntityId: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChapterScene = Selectable<ChapterScenesTable>;
export type NewChapterScene = Insertable<ChapterScenesTable>;
export type ChapterSceneUpdate = Updateable<ChapterScenesTable>;

export interface ChapterSceneGroupsTable {
  id: string;
  bookId: string;
  idx: number;
  startChapterId: string;
  endChapterId: string;
  chapterSceneIds: string[];
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChapterSceneGroup = Selectable<ChapterSceneGroupsTable>;
export type NewChapterSceneGroup = Insertable<ChapterSceneGroupsTable>;
export type ChapterSceneGroupUpdate = Updateable<ChapterSceneGroupsTable>;

export interface ChapterRelationshipsTable {
  id: string;
  bookId: string;
  chapterId: string;
  sourceBookEntityId: string;
  targetBookEntityId: string;
  predicateType: string;
  predicateDescription: string;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChapterRelationship = Selectable<ChapterRelationshipsTable>;
export type NewChapterRelationship = Insertable<ChapterRelationshipsTable>;
export type ChapterRelationshipUpdate = Updateable<ChapterRelationshipsTable>;

export interface ChapterEntityAppellationsTable {
  id: string;
  bookId: string;
  chapterId: string;
  sourceBookEntityId: string;
  targetBookEntityId: string;
  phrase: string;
  type: string;
  context: string;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChapterEntityAppellation = Selectable<ChapterEntityAppellationsTable>;
export type NewChapterEntityAppellation = Insertable<ChapterEntityAppellationsTable>;
export type ChapterEntityAppellationUpdate = Updateable<ChapterEntityAppellationsTable>;

export interface ChapterEntityAttributesTable {
  id: string;
  bookId: string;
  chapterId: string;
  bookEntityId: string;
  category: string;
  name: string;
  value: string;
  evidence: string;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ChapterEntityAttribute = Selectable<ChapterEntityAttributesTable>;
export type NewChapterEntityAttribute = Insertable<ChapterEntityAttributesTable>;
export type ChapterEntityAttributeUpdate = Updateable<ChapterEntityAttributesTable>;

export interface BookEntitiesTable {
  id: string;
  friendlyId: string;
  bookId: string;
  name: string;
  type: string;
  aliases: string[];
  pronouns: string | null;
  description: string | null;
  significanceTier: 'PRIMARY' | 'SECONDARY' | null;
  significanceRank: number | null;
  names: Generated<string[]>;
  continuedFromBookEntityId: string | null;
  hasVoice: Generated<boolean>;
  label: string | null;
  minorStatus: Generated<'NEVER' | 'THROUGHOUT' | 'UNTIL_CHAPTER'>;
  minorUntilChapterId: string | null;
  identityTag: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookEntity = Selectable<BookEntitiesTable>;
export type NewBookEntity = Insertable<BookEntitiesTable>;
export type BookEntityUpdate = Updateable<BookEntitiesTable>;

export interface BookEntityHierarchiesTable {
  id: string;
  bookId: string;
  bookEntityId: string;
  level: 'REALM' | 'HUB' | 'LOCALE' | 'MICRO';
  parentBookEntityId: string | null;
  classificationReasoning: string | null;
  significanceRank: number | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookEntityHierarchy = Selectable<BookEntityHierarchiesTable>;
export type NewBookEntityHierarchy = Insertable<BookEntityHierarchiesTable>;
export type BookEntityHierarchyUpdate = Updateable<BookEntityHierarchiesTable>;

export interface BookArcsTable {
  id: string;
  bookId: string;
  type: string;
  startChapterId: string;
  endChapterId: string;
  title: string;
  content: string;
  bookEntityIds: string[];
  friendlyIdPrefix: string;
  friendlyIdIdx: number;
  friendlyId: Generated<string>; // Generated: prefix || idx
  imageUrl: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookArc = Selectable<BookArcsTable>;
export type NewBookArc = Insertable<BookArcsTable>;
export type BookArcUpdate = Updateable<BookArcsTable>;

export interface BookCategoriesTable {
  id: string;
  bookId: string;
  name: string;
  description: string;
  examples: Generated<JsonValue[]>;
  type: string;
  exclusion: string | null;
  allowedTypes: Generated<string[]>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookCategory = Selectable<BookCategoriesTable>;
export type NewBookCategory = Insertable<BookCategoriesTable>;
export type BookCategoryUpdate = Updateable<BookCategoriesTable>;

export interface BookCharacterPlaceScoresTable {
  id: string;
  bookId: string;
  characterBookEntityId: string;
  placeBookEntityId: string;
  score: number;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookCharacterPlaceScore = Selectable<BookCharacterPlaceScoresTable>;
export type NewBookCharacterPlaceScore = Insertable<BookCharacterPlaceScoresTable>;
export type BookCharacterPlaceScoreUpdate = Updateable<BookCharacterPlaceScoresTable>;

export interface BookImportsTable {
  id: string;
  userId: string;
  fileUrl: string;
  imageUrl: string | null;
  title: string;
  status:
    | 'pending'
    | 'projection'
    | 'awaiting_projection'
    | 'extract'
    | 'awaiting_selection'
    | 'arc'
    | 'completed'
    | 'failed';
  lastError: string | null;
  convertExecutionId: string | null;
  convertJobUrl: string | null;
  errorCount: Generated<number>;
  bookId: string | null;
  organizationIds: Generated<string[]>;
  notificationsEnabled: Generated<boolean>;
  etaMinSeconds: number | null;
  etaMaxSeconds: number | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  projectionBehavior: 'normal' | 'unknown' | null;
  autoConfirmProjection: Generated<boolean>;
  textProviderModelId: string | null;
  textLightProviderModelId: string | null;
  previousInSeriesBookId: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookImport = Selectable<BookImportsTable>;
export type NewBookImport = Insertable<BookImportsTable>;
export type BookImportUpdate = Updateable<BookImportsTable>;

export interface BookStylesTable {
  id: string;
  bookId: string;
  pov: string;
  povEntity: string;
  povBookEntityId: string | null;
  styleAnalysis: string;
  isMajority: Generated<boolean>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookStyle = Selectable<BookStylesTable>;
export type NewBookStyle = Insertable<BookStylesTable>;
export type BookStyleUpdate = Updateable<BookStylesTable>;

export type ProviderAuthShape =
  | { kind: 'none' }
  | { kind: 'bearer' }
  | { kind: 'header'; header: string }
  | { kind: 'queryParam'; param: string }
  | { kind: 'body'; field: string };

export interface ProvidersTable {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  baseUrl: string | null;
  authShape: Generated<ProviderAuthShape>;
  username: string | null;
  secret: string | null;
  secretLast4: string | null;
  secretEnvVar: string | null;
  secretPriority: Generated<'key' | 'env'>;
  rpmLimit: number | null;
  config: Record<string, JsonValue> | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type Provider = Selectable<ProvidersTable>;
export type NewProvider = Insertable<ProvidersTable>;
export type ProviderUpdate = Updateable<ProvidersTable>;

export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ProviderModelsTable {
  id: string;
  providerId: string;
  modelKey: string;
  displayName: string | null;
  config: Record<string, JsonValue> | null;
  reasoning: ReasoningLevel | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ProviderModel = Selectable<ProviderModelsTable>;
export type NewProviderModel = Insertable<ProviderModelsTable>;
export type ProviderModelUpdate = Updateable<ProviderModelsTable>;

export type ExtensionProvenanceType = 'bundled' | 'local' | 'github';

export interface ExtensionsTable {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: Generated<boolean>;
  manifest: Record<string, unknown>;
  config: Generated<Record<string, unknown>>;
  provenanceType: Generated<ExtensionProvenanceType>;
  provenanceConfig: Generated<Record<string, unknown>>;
  // Re-derived in Rust at install; gates Cloud-provider eligibility for non-bundled extensions.
  signed: Generated<boolean>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type Extension = Selectable<ExtensionsTable>;
export type NewExtension = Insertable<ExtensionsTable>;
export type ExtensionUpdate = Updateable<ExtensionsTable>;

export interface ExtensionProvidersTable {
  extensionId: string;
  providerKey: string;
  providerId: string;
  overrideBaseUrl: string | null;
  modelKey: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type ExtensionProvider = Selectable<ExtensionProvidersTable>;
export type NewExtensionProvider = Insertable<ExtensionProvidersTable>;

export interface OrganizationTextModelsTable {
  organizationId: string;
  textProviderModelId: string | null;
  textLightProviderModelId: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type OrganizationTextModel = Selectable<OrganizationTextModelsTable>;
export type NewOrganizationTextModel = Insertable<OrganizationTextModelsTable>;
export type OrganizationTextModelUpdate = Updateable<OrganizationTextModelsTable>;

export interface NarrativeLine {
  id: string;
  text: string;
  kind?: 'error';
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogLine {
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineStepsTable {
  id: string;
  bookImportId: string;
  stepId: string;
  fanOutKey: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  attemptCount: Generated<number>;
  lastError: string | null;
  narrative: Generated<NarrativeLine[]>;
  logs: Generated<LogLine[]>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface PipelineStepUsagesTable {
  id: string;
  pipelineStepId: string;
  provider: string;
  model: string;
  responseModel: string | null;
  inputTokens: Generated<number>;
  outputTokens: Generated<number>;
  cacheReadTokens: Generated<number>;
  cacheWriteTokens: Generated<number>;
  reasoningTokens: Generated<number>;
  totalTokens: Generated<number>;
  costInput: Generated<number>;
  costOutput: Generated<number>;
  costCacheRead: Generated<number>;
  costCacheWrite: Generated<number>;
  costTotal: Generated<number>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type PipelineStepUsage = Selectable<PipelineStepUsagesTable>;
export type NewPipelineStepUsage = Insertable<PipelineStepUsagesTable>;

export type PipelineStep = Selectable<PipelineStepsTable>;
export type NewPipelineStep = Insertable<PipelineStepsTable>;
export type PipelineStepUpdate = Updateable<PipelineStepsTable>;

export interface BookEntityExtractionCheckpointEntity {
  id: number;
  label: string;
  names: string[];
  description?: string;
  pronouns?: string;
  has_voice?: boolean;
  friendlyId?: string;
  type?: string;
}

export interface BookEntityExtractionCheckpointsTable {
  id: string;
  bookId: string;
  schemaVersion: number;
  entities: Generated<BookEntityExtractionCheckpointEntity[]>;
  nextEntityId: Generated<number>;
  completeChapters: Generated<number[]>;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export type BookEntityExtractionCheckpoint =
  Selectable<BookEntityExtractionCheckpointsTable>;
export type NewBookEntityExtractionCheckpoint =
  Insertable<BookEntityExtractionCheckpointsTable>;
export type BookEntityExtractionCheckpointUpdate =
  Updateable<BookEntityExtractionCheckpointsTable>;

export interface Database {
  users: UsersTable;
  books: BooksTable;
  bookSeeds: BookSeedsTable;
  chapters: ChaptersTable;
  chapterParagraphs: ChapterParagraphsTable;
  chapterScenes: ChapterScenesTable;
  chapterSceneGroups: ChapterSceneGroupsTable;
  chapterRelationships: ChapterRelationshipsTable;
  chapterEntityAppellations: ChapterEntityAppellationsTable;
  chapterEntityAttributes: ChapterEntityAttributesTable;
  bookEntities: BookEntitiesTable;
  bookEntityHierarchies: BookEntityHierarchiesTable;
  bookArcs: BookArcsTable;
  bookCategories: BookCategoriesTable;
  bookCharacterPlaceScores: BookCharacterPlaceScoresTable;
  bookImports: BookImportsTable;
  bookStyles: BookStylesTable;
  providers: ProvidersTable;
  providerModels: ProviderModelsTable;
  pipelineSteps: PipelineStepsTable;
  pipelineStepUsages: PipelineStepUsagesTable;
  extensions: ExtensionsTable;
  extensionProviders: ExtensionProvidersTable;
  organizationTextModels: OrganizationTextModelsTable;
  bookEntityExtractionCheckpoints: BookEntityExtractionCheckpointsTable;
}

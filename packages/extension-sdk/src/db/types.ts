import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

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
  friendlyId: Generated<string>;
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

export interface SeededDatabase {
  books: BooksTable;
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
  bookStyles: BookStylesTable;
}

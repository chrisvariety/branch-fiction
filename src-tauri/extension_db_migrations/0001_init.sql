-- Reserved tables for extension SQLite databases. Mirrors the book/chapter
-- slice of the main DB schema. Extensions must not name their own tables
-- with these prefixes; everything else is theirs.
--
-- Differences from the main DB:
-- - No `users` table; `books.user_id` keeps its column but drops the FK.
-- - Migration tracking via `book_migrations` (instead of the host's own
--   migration mechanism) so extension authors can introspect which version
--   of the reserved schema is installed without running into the FK-less
--   `_sqlx_migrations` semantics from the host.

CREATE TABLE IF NOT EXISTS book_migrations (
  version integer PRIMARY KEY,
  description text NOT NULL,
  applied_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS books (
  id text PRIMARY KEY,
  share_code text NOT NULL UNIQUE,
  user_id text NOT NULL,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  isbn text UNIQUE,
  language text,
  publisher text,
  character_rank_type text CHECK (character_rank_type IN ('EPISODIC', 'ENSEMBLE')),
  image_url text,
  status text,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS books_user_id_idx ON books(user_id);
CREATE INDEX IF NOT EXISTS books_share_code_idx ON books(share_code);

CREATE TABLE IF NOT EXISTS chapters (
  id text PRIMARY KEY,
  idx integer NOT NULL,
  href text NOT NULL,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text,
  end_summary text,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chapters_book_idx ON chapters(book_id, idx);

CREATE TABLE IF NOT EXISTS chapter_paragraphs (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_idx integer NOT NULL,
  paragraph_idx integer NOT NULL,
  book_paragraph_idx integer NOT NULL,
  content text NOT NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now')),
  UNIQUE (book_id, book_paragraph_idx),
  UNIQUE (chapter_id, paragraph_idx)
);

CREATE INDEX IF NOT EXISTS chapter_paragraphs_book_idx ON chapter_paragraphs(book_id);
CREATE INDEX IF NOT EXISTS chapter_paragraphs_chapter_id_idx ON chapter_paragraphs(chapter_id);

CREATE TABLE IF NOT EXISTS book_entities (
  id text PRIMARY KEY,
  friendly_id text NOT NULL,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  aliases text NOT NULL DEFAULT '[]',
  pronouns text,
  description text,
  significance_tier text,
  significance_rank integer,
  names text NOT NULL DEFAULT '[]',
  continued_from_book_entity_id text REFERENCES book_entities(id) ON DELETE SET NULL,
  has_voice integer NOT NULL DEFAULT 0,
  label text,
  minor_status text NOT NULL DEFAULT 'NEVER',
  minor_until_chapter_id text REFERENCES chapters(id) ON DELETE SET NULL,
  identity_tag text,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS book_entities_book_idx ON book_entities(book_id);
CREATE INDEX IF NOT EXISTS book_entities_book_friendly_id_idx ON book_entities(book_id, friendly_id);
CREATE INDEX IF NOT EXISTS book_entities_book_type_significance_idx ON book_entities(book_id, type, significance_tier);

CREATE TABLE IF NOT EXISTS book_arcs (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  type text NOT NULL,
  start_chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  end_chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  book_entity_ids text NOT NULL DEFAULT '[]',
  friendly_id_prefix text NOT NULL DEFAULT '',
  friendly_id_idx integer NOT NULL DEFAULT 0,
  friendly_id text GENERATED ALWAYS AS (friendly_id_prefix || friendly_id_idx) STORED,
  image_url text,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS book_arcs_book_id_friendly_id_idx ON book_arcs(book_id, friendly_id);
CREATE INDEX IF NOT EXISTS book_arcs_book_id_idx ON book_arcs(book_id);
CREATE INDEX IF NOT EXISTS book_arcs_book_id_type_idx ON book_arcs(book_id, type);

CREATE TABLE IF NOT EXISTS book_entity_hierarchies (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  book_entity_id text NOT NULL UNIQUE REFERENCES book_entities(id) ON DELETE CASCADE,
  level text NOT NULL,
  parent_book_entity_id text REFERENCES book_entities(id) ON DELETE CASCADE,
  classification_reasoning text,
  significance_rank integer,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loc_hierarchy_level ON book_entity_hierarchies(book_id, level);
CREATE INDEX IF NOT EXISTS idx_loc_hierarchy_parent ON book_entity_hierarchies(parent_book_entity_id);

CREATE TABLE IF NOT EXISTS chapter_scenes (
  id text PRIMARY KEY,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  start_chapter_paragraph_id text NOT NULL REFERENCES chapter_paragraphs(id) ON DELETE CASCADE,
  end_chapter_paragraph_id text NOT NULL REFERENCES chapter_paragraphs(id) ON DELETE CASCADE,
  pov_book_entity_id text REFERENCES book_entities(id) ON DELETE SET NULL,
  pov text NOT NULL,
  title text NOT NULL,
  is_preliminary integer NOT NULL DEFAULT 0,
  pov_entity text NOT NULL,
  location text,
  setting text,
  location_book_entity_id text REFERENCES book_entities(id) ON DELETE SET NULL,
  setting_book_entity_id text REFERENCES book_entities(id) ON DELETE SET NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chapter_scenes_book_id_idx ON chapter_scenes(book_id);
CREATE INDEX IF NOT EXISTS chapter_scenes_chapter_id_idx ON chapter_scenes(chapter_id);

CREATE TABLE IF NOT EXISTS chapter_scene_groups (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  start_chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  end_chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_scene_ids text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chapter_scene_groups_book_id_idx_idx ON chapter_scene_groups(book_id, idx);

CREATE TABLE IF NOT EXISTS chapter_relationships (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  source_book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  target_book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  predicate_type text NOT NULL,
  predicate_description text NOT NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chapter_relationships_source_book_entity_id_idx ON chapter_relationships(source_book_entity_id);
CREATE INDEX IF NOT EXISTS chapter_relationships_target_book_entity_id_idx ON chapter_relationships(target_book_entity_id);

CREATE TABLE IF NOT EXISTS chapter_entity_appellations (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  source_book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  target_book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  phrase text NOT NULL,
  type text NOT NULL,
  context text NOT NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chapter_entity_appellations_book_id_idx ON chapter_entity_appellations(book_id);
CREATE INDEX IF NOT EXISTS chapter_entity_appellations_chapter_id_idx ON chapter_entity_appellations(chapter_id);
CREATE INDEX IF NOT EXISTS chapter_entity_appellations_source_book_entity_id_idx ON chapter_entity_appellations(source_book_entity_id);
CREATE INDEX IF NOT EXISTS chapter_entity_appellations_target_book_entity_id_idx ON chapter_entity_appellations(target_book_entity_id);

CREATE TABLE IF NOT EXISTS chapter_entity_attributes (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  category text NOT NULL,
  name text NOT NULL,
  value text NOT NULL,
  evidence text NOT NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chapter_entity_attributes_book_id_idx ON chapter_entity_attributes(book_id);
CREATE INDEX IF NOT EXISTS chapter_entity_attributes_book_entity_id_idx ON chapter_entity_attributes(book_entity_id);

CREATE TABLE IF NOT EXISTS book_categories (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  examples text NOT NULL DEFAULT '[]',
  type text NOT NULL,
  exclusion text,
  allowed_types text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS book_categories_book_id_idx ON book_categories(book_id);

CREATE TABLE IF NOT EXISTS book_character_place_scores (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  character_book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  place_book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  score real NOT NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now')),
  UNIQUE (book_id, character_book_entity_id, place_book_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_character_place_scores_book_id ON book_character_place_scores(book_id);
CREATE INDEX IF NOT EXISTS idx_character_place_scores_character ON book_character_place_scores(character_book_entity_id);

CREATE TABLE IF NOT EXISTS book_styles (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  pov text NOT NULL,
  pov_entity text NOT NULL,
  pov_book_entity_id text REFERENCES book_entities(id) ON DELETE CASCADE,
  style_analysis text NOT NULL,
  is_majority integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_book_styles_book_id ON book_styles(book_id);

INSERT OR IGNORE INTO book_migrations (version, description) VALUES (1, 'init');

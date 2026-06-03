CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified integer NOT NULL,
  image text,
  external_id varchar(1024) UNIQUE,
  is_anonymous integer,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE books (
  id text PRIMARY KEY,
  share_code text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  isbn text UNIQUE,
  language text,
  publisher text,
  character_rank_type text CHECK (character_rank_type IN ('EPISODIC', 'ENSEMBLE')),
  image_url text,
  availability_status text,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users (id, name, email, email_verified) VALUES ('default', 'default', 'default@local', 0);

CREATE UNIQUE INDEX users_external_id_idx ON users(external_id);

CREATE INDEX books_user_id_idx ON books(user_id);
CREATE INDEX books_share_code_idx ON books(share_code);

CREATE TABLE chapters (
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

CREATE INDEX chapters_book_idx ON chapters(book_id, idx);

CREATE TABLE chapter_paragraphs (
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

CREATE INDEX chapter_paragraphs_book_idx ON chapter_paragraphs(book_id);
CREATE INDEX chapter_paragraphs_chapter_id_idx ON chapter_paragraphs(chapter_id);

CREATE TABLE book_entities (
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

CREATE INDEX book_entities_book_idx ON book_entities(book_id);
CREATE INDEX book_entities_book_friendly_id_idx ON book_entities(book_id, friendly_id);
CREATE INDEX book_entities_book_type_significance_idx ON book_entities(book_id, type, significance_tier);

CREATE TABLE book_arcs (
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

CREATE UNIQUE INDEX book_arcs_book_id_friendly_id_idx ON book_arcs(book_id, friendly_id);
CREATE INDEX book_arcs_book_id_idx ON book_arcs(book_id);
CREATE INDEX book_arcs_book_id_type_idx ON book_arcs(book_id, type);

CREATE TABLE book_entity_hierarchies (
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

CREATE INDEX idx_loc_hierarchy_level ON book_entity_hierarchies(book_id, level);
CREATE INDEX idx_loc_hierarchy_parent ON book_entity_hierarchies(parent_book_entity_id);

CREATE TABLE chapter_scenes (
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

CREATE INDEX chapter_scenes_book_id_idx ON chapter_scenes(book_id);
CREATE INDEX chapter_scenes_chapter_id_idx ON chapter_scenes(chapter_id);

CREATE TABLE chapter_scene_groups (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  start_chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  end_chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_scene_ids text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX chapter_scene_groups_book_id_idx_idx ON chapter_scene_groups(book_id, idx);

CREATE TABLE chapter_relationships (
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

CREATE INDEX chapter_relationships_source_book_entity_id_idx ON chapter_relationships(source_book_entity_id);
CREATE INDEX chapter_relationships_target_book_entity_id_idx ON chapter_relationships(target_book_entity_id);

CREATE TABLE chapter_entity_appellations (
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

CREATE INDEX chapter_entity_appellations_book_id_idx ON chapter_entity_appellations(book_id);
CREATE INDEX chapter_entity_appellations_chapter_id_idx ON chapter_entity_appellations(chapter_id);
CREATE INDEX chapter_entity_appellations_source_book_entity_id_idx ON chapter_entity_appellations(source_book_entity_id);
CREATE INDEX chapter_entity_appellations_target_book_entity_id_idx ON chapter_entity_appellations(target_book_entity_id);

CREATE TABLE chapter_entity_attributes (
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

CREATE INDEX chapter_entity_attributes_book_id_idx ON chapter_entity_attributes(book_id);
CREATE INDEX chapter_entity_attributes_book_entity_id_idx ON chapter_entity_attributes(book_entity_id);

CREATE TABLE book_categories (
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

CREATE INDEX book_categories_book_id_idx ON book_categories(book_id);

CREATE TABLE book_character_place_scores (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  character_book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  place_book_entity_id text NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
  score real NOT NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now')),
  UNIQUE (book_id, character_book_entity_id, place_book_entity_id)
);

CREATE INDEX idx_character_place_scores_book_id ON book_character_place_scores(book_id);
CREATE INDEX idx_character_place_scores_character ON book_character_place_scores(character_book_entity_id);

CREATE TABLE book_imports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  last_error text,
  image_url text,
  convert_execution_id text,
  convert_job_url text,
  error_count integer DEFAULT 0,
  book_id text REFERENCES books(id) ON DELETE CASCADE,
  organization_ids text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE book_styles (
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

CREATE INDEX idx_book_styles_book_id ON book_styles(book_id);

CREATE TABLE providers (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  base_url text,
  auth_shape text NOT NULL DEFAULT '{}',
  username text,
  secret text,
  secret_last4 text,
  secret_env_var text,
  secret_priority text NOT NULL DEFAULT 'key',
  config text,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX providers_organization_id_idx ON providers(organization_id);

CREATE TABLE provider_models (
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_key text NOT NULL,
  display_name text,
  config text,
  slots text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider_id, model_key)
);

CREATE INDEX provider_models_provider_id_idx ON provider_models(provider_id);

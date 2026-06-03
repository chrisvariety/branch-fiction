CREATE TABLE book_entity_extraction_checkpoints (
  id text PRIMARY KEY,
  book_id text NOT NULL UNIQUE REFERENCES books(id) ON DELETE CASCADE,
  schema_version integer NOT NULL,
  entities text NOT NULL DEFAULT '[]',
  next_entity_id integer NOT NULL DEFAULT 1,
  complete_chapters text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

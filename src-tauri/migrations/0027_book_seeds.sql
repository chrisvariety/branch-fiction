CREATE TABLE IF NOT EXISTS book_seeds (
  name text PRIMARY KEY,
  book_id text NOT NULL,
  schema_version integer NOT NULL,
  applied_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plugins (
  id text PRIMARY KEY,
  name text NOT NULL,
  version text NOT NULL,
  path text NOT NULL,
  enabled integer NOT NULL DEFAULT 1,
  manifest text NOT NULL,
  config text NOT NULL DEFAULT '{}',
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

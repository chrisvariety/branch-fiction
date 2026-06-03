CREATE TABLE plugin_dev_clients (
  plugin_id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  created_at text NOT NULL DEFAULT (datetime('now')),
  last_used_at text,
  revoked_at text
);

CREATE TABLE plugin_providers (
  plugin_id text NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  provider_id text NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, provider_key)
);

CREATE INDEX idx_plugin_providers_provider ON plugin_providers(provider_id);

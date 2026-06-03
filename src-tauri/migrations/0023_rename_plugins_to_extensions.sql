ALTER TABLE plugins RENAME TO extensions;
ALTER TABLE plugin_providers RENAME TO extension_providers;
ALTER TABLE extension_providers RENAME COLUMN plugin_id TO extension_id;
DROP INDEX idx_plugin_providers_provider;
CREATE INDEX idx_extension_providers_provider ON extension_providers(provider_id);
ALTER TABLE plugin_dev_clients RENAME TO extension_dev_clients;
ALTER TABLE extension_dev_clients RENAME COLUMN plugin_id TO extension_id;

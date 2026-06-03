-- Collapse the "slot" abstraction. An extension options-binding now stores its
-- chosen model directly on the binding row, and the user's text-model choice is a
-- first-class global default (snapshotted per book import).

-- Options bindings carry their own model key. Nullable: model-less options exist
-- (e.g. a segmentation workflow URL declares no model).
ALTER TABLE extension_providers ADD COLUMN model_key text;

-- Global default text model (per organization). Book imports snapshot these into
-- their own text_provider_model_id columns at import time.
CREATE TABLE organization_text_models (
  organization_id text PRIMARY KEY,
  text_provider_model_id text REFERENCES provider_models(id) ON DELETE SET NULL,
  text_light_provider_model_id text REFERENCES provider_models(id) ON DELETE SET NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

-- The slots JSON only ever held synthetic extension:<id>#<key> strings, now
-- superseded by extension_providers.model_key.
ALTER TABLE provider_models DROP COLUMN slots;

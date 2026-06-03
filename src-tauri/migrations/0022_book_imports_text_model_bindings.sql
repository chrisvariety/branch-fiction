ALTER TABLE book_imports ADD COLUMN text_provider_model_id text REFERENCES provider_models(id) ON DELETE SET NULL;
ALTER TABLE book_imports ADD COLUMN text_light_provider_model_id text REFERENCES provider_models(id) ON DELETE SET NULL;

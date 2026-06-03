ALTER TABLE plugins ADD COLUMN provenance_type TEXT NOT NULL DEFAULT 'local';
ALTER TABLE plugins ADD COLUMN provenance_config TEXT NOT NULL DEFAULT '{}';

UPDATE plugins SET provenance_type = 'bundled' WHERE bundled = 1;

ALTER TABLE plugins DROP COLUMN bundled;

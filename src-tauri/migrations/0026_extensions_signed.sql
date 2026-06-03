-- Whether the installed bytes carry a valid first-party signature, re-derived
-- in Rust at install time. Drives Cloud-provider eligibility for non-bundled
-- extensions. Existing rows default to unsigned until reinstalled.
ALTER TABLE extensions ADD COLUMN signed INTEGER NOT NULL DEFAULT 0;

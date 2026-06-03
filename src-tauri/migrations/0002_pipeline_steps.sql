CREATE TABLE pipeline_steps (
  id text PRIMARY KEY,
  book_import_id text NOT NULL REFERENCES book_imports(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  fan_out_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  narrative text NOT NULL DEFAULT '[]',
  started_at text,
  completed_at text,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pipeline_steps_import ON pipeline_steps(book_import_id, step_id);

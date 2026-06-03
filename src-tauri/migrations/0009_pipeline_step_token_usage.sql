CREATE TABLE pipeline_step_usages (
  id text PRIMARY KEY,
  pipeline_step_id text NOT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  response_model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cost_input real NOT NULL DEFAULT 0,
  cost_output real NOT NULL DEFAULT 0,
  cost_cache_read real NOT NULL DEFAULT 0,
  cost_cache_write real NOT NULL DEFAULT 0,
  cost_total real NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pipeline_step_usages_step ON pipeline_step_usages(pipeline_step_id);

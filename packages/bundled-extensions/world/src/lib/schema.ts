// Idempotent bootstrap for the extension's own tables (host book tables already exist).
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    character_entity_id TEXT NOT NULL,
    place_entity_id TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    seed_image_url TEXT NOT NULL,
    suggested_actions TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS worlds_book_id_idx ON worlds (book_id)`
];

const ADDITIVE_STATEMENTS = [`ALTER TABLE worlds ADD COLUMN suggested_actions TEXT`];

export async function ensureSchema(db: {
  query: (stmt: string) => Promise<void>;
}): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.query(stmt);
  }
  for (const stmt of ADDITIVE_STATEMENTS) {
    try {
      await db.query(stmt);
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
  }
}

function isDuplicateColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('duplicate column name');
}

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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS worlds_book_id_idx ON worlds (book_id)`
];

export async function ensureSchema(db: {
  query: (stmt: string) => Promise<void>;
}): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.query(stmt);
  }
}

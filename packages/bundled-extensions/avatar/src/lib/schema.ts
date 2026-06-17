// Idempotent bootstrap for the extension's own tables (host book tables already exist).
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS avatars (
    character_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    image_url TEXT NOT NULL,
    personality TEXT NOT NULL,
    art_style TEXT,
    selected_arc_friendly_id TEXT,
    runway_avatar_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (book_id, character_id)
  )`,
  `CREATE INDEX IF NOT EXISTS avatars_book_id_idx ON avatars (book_id)`
];

export async function ensureSchema(db: {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.query(stmt);
  }
}

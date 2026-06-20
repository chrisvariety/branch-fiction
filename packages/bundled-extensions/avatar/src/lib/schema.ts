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
  `CREATE INDEX IF NOT EXISTS avatars_book_id_idx ON avatars (book_id)`,
  `CREATE TABLE IF NOT EXISTS avatar_scenarios (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    scenario_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    label TEXT NOT NULL,
    tagline TEXT NOT NULL,
    start_script TEXT NOT NULL,
    personality TEXT NOT NULL,
    knowledge TEXT NOT NULL,
    knowledge_hash TEXT NOT NULL,
    anchor_chapter_idx INTEGER,
    runway_document_id TEXT,
    runway_document_hash TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (book_id, character_id, scenario_key)
  )`,
  `CREATE INDEX IF NOT EXISTS avatar_scenarios_character_idx
    ON avatar_scenarios (book_id, character_id)`
];

export async function ensureSchema(db: {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.query(stmt);
  }
}

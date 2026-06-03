// TODO: simple migration system (just an array of ALTERs ?)
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS first_launch_steps (
     id             TEXT PRIMARY KEY,
     book_id        TEXT NOT NULL,
     step_id        TEXT NOT NULL,
     fan_out_key    TEXT,
     attempt_count  INTEGER NOT NULL DEFAULT 0,
     last_error     TEXT,
     logs           TEXT NOT NULL DEFAULT '[]',
     started_at     TEXT,
     completed_at   TEXT,
     created_at     TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS first_launch_steps_book_id_step_id_idx
     ON first_launch_steps(book_id, step_id)`,
  `CREATE TABLE IF NOT EXISTS character_refs (
     character_id              TEXT NOT NULL,
     book_id                   TEXT NOT NULL,
     selected_arc_friendly_id  TEXT NOT NULL,
     selected_arc_id           TEXT NOT NULL,
     image_url                 TEXT NOT NULL,
     created_at                TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (character_id, book_id)
   )`,

  `CREATE TABLE IF NOT EXISTS book_settings (
     book_id                   TEXT PRIMARY KEY,
     art_style                 TEXT,
     character_interactive_type TEXT,
     place_interactive_type    TEXT,
     created_at                TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS book_interactives (
     id          TEXT PRIMARY KEY,
     book_id     TEXT NOT NULL,
     type        TEXT NOT NULL,
     url         TEXT,
     width       INTEGER,
     height      INTEGER,
     video_url   TEXT,
     status      TEXT NOT NULL,
     created_at  TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS book_interactive_entities (
     id                    TEXT PRIMARY KEY,
     book_id               TEXT NOT NULL,
     book_interactive_id   TEXT NOT NULL REFERENCES book_interactives(id) ON DELETE CASCADE,
     book_entity_id        TEXT NOT NULL,
     selected_book_arc_id  TEXT NOT NULL,
     click_area            TEXT,
     head_area             TEXT,
     image_url             TEXT,
     segment_class         TEXT NOT NULL,
     position              TEXT,
     description           TEXT,
     head_image_url        TEXT,
     cropped_image_url     TEXT,
     created_at            TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS book_interactive_entities_book_interactive_id_idx
     ON book_interactive_entities(book_interactive_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS user_worlds (
     id                         TEXT PRIMARY KEY,
     title                      TEXT NOT NULL,
     slug                       TEXT NOT NULL,
     user_id                    TEXT NOT NULL,
     scenario_ids               TEXT NOT NULL DEFAULT '[]',
     book_interactive_entity_ids TEXT NOT NULL DEFAULT '[]',
     book_ids                   TEXT NOT NULL DEFAULT '[]',
     access_type                TEXT,
     image_url                  TEXT,
     art_style                  TEXT,
     character_interactive_type TEXT NOT NULL DEFAULT 'CHARACTER_VERTICAL',
     place_interactive_type     TEXT NOT NULL DEFAULT 'PLACE_VERTICAL',
     created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at                 TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (user_id, slug)
   )`,
  `CREATE INDEX IF NOT EXISTS user_worlds_user_id_idx ON user_worlds(user_id)`,

  `CREATE TABLE IF NOT EXISTS scenarios (
     id                         TEXT PRIMARY KEY,
     book_id                    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
     relationship_book_arc_id   TEXT REFERENCES book_arcs(id) ON DELETE SET NULL,
     title                      TEXT NOT NULL,
     description                TEXT NOT NULL,
     tone_tags                  TEXT NOT NULL DEFAULT '[]',
     appellation_book_arc_ids   TEXT NOT NULL DEFAULT '[]',
     additional_book_entity_ids TEXT NOT NULL DEFAULT '[]',
     friendly_id_prefix         TEXT NOT NULL DEFAULT '',
     friendly_id_idx            INTEGER NOT NULL DEFAULT 0,
     friendly_id                TEXT GENERATED ALWAYS AS (friendly_id_prefix || friendly_id_idx) STORED,
     character_interactive_type TEXT NOT NULL DEFAULT 'CHARACTER_VERTICAL',
     place_interactive_type     TEXT NOT NULL DEFAULT 'PLACE_VERTICAL',
     created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS scenarios_book_id_friendly_id_idx
     ON scenarios(book_id, friendly_id)`,
  `CREATE INDEX IF NOT EXISTS scenarios_book_id_idx ON scenarios(book_id)`,
  `CREATE INDEX IF NOT EXISTS scenarios_relationship_book_arc_id_idx
     ON scenarios(relationship_book_arc_id)`,

  `CREATE TABLE IF NOT EXISTS scenario_entities (
     id                       TEXT PRIMARY KEY,
     idx                      INTEGER NOT NULL,
     scenario_id              TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
     book_id                  TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
     book_entity_id           TEXT NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
     book_arc_id              TEXT NOT NULL REFERENCES book_arcs(id) ON DELETE CASCADE,
     appearance_book_arc_id   TEXT REFERENCES book_arcs(id) ON DELETE SET NULL,
     image_url                TEXT,
     description              TEXT,
     created_at               TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS scenario_entities_scenario_id_idx
     ON scenario_entities(scenario_id)`,
  `CREATE INDEX IF NOT EXISTS scenario_entities_scenario_id_idx_idx
     ON scenario_entities(scenario_id, idx)`,
  `CREATE INDEX IF NOT EXISTS scenario_entities_book_entity_id_idx
     ON scenario_entities(book_entity_id)`,
  `CREATE INDEX IF NOT EXISTS scenario_entities_book_arc_id_idx
     ON scenario_entities(book_arc_id)`,

  `CREATE TABLE IF NOT EXISTS chats (
     id                         TEXT PRIMARY KEY,
     title                      TEXT NOT NULL,
     slug                       TEXT NOT NULL,
     user_id                    TEXT NOT NULL,
     organization_id            TEXT,
     relationship_book_arc_id   TEXT REFERENCES book_arcs(id) ON DELETE SET NULL,
     scenario_id                TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
     tone_tags                  TEXT NOT NULL DEFAULT '[]',
     appellation_book_arc_ids   TEXT NOT NULL DEFAULT '[]',
     additional_book_entity_ids TEXT NOT NULL DEFAULT '[]',
     access_type                TEXT,
     art_style                  TEXT,
     current_leaf_node_id       TEXT,
     user_world_id              TEXT REFERENCES user_worlds(id) ON DELETE SET NULL,
     book_ids                   TEXT NOT NULL DEFAULT '[]',
     system_prompt              TEXT NOT NULL,
     image_mode                 TEXT NOT NULL DEFAULT 'occasional',
     initial_image_model        TEXT,
     current_image_model        TEXT,
     created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at                 TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (user_id, slug)
   )`,
  `CREATE INDEX IF NOT EXISTS chats_user_id_scenario_id_idx ON chats(user_id, scenario_id)`,
  `CREATE INDEX IF NOT EXISTS chats_user_id_updated_at_idx ON chats(user_id, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS chat_entities (
     id                       TEXT PRIMARY KEY,
     idx                      INTEGER NOT NULL,
     chat_id                  TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
     book_id                  TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
     book_entity_id           TEXT NOT NULL REFERENCES book_entities(id) ON DELETE CASCADE,
     book_arc_id              TEXT NOT NULL REFERENCES book_arcs(id) ON DELETE CASCADE,
     modifier                 TEXT,
     appearance_book_arc_id   TEXT REFERENCES book_arcs(id) ON DELETE SET NULL,
     image_url                TEXT,
     description              TEXT,
     created_at               TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS chat_entities_book_arc_id_idx
     ON chat_entities(book_arc_id)`,

  `CREATE TABLE IF NOT EXISTS chat_nodes (
     id                     TEXT PRIMARY KEY,
     chat_id                TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
     parent_node_id         TEXT REFERENCES chat_nodes(id) ON DELETE CASCADE,
     action_label           TEXT NOT NULL,
     action_type            TEXT NOT NULL,
     system_instruction     TEXT,
     depth                  INTEGER NOT NULL DEFAULT 0,
     children_count         INTEGER NOT NULL DEFAULT 0,
     should_generate_visual INTEGER NOT NULL DEFAULT 0,
     created_at             TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS chat_nodes_chat_id_created_at_idx
     ON chat_nodes(chat_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS chat_nodes_parent_id_idx
     ON chat_nodes(parent_node_id)`,
  `CREATE TRIGGER IF NOT EXISTS chat_nodes_maintain_graph_after_insert
   AFTER INSERT ON chat_nodes
   FOR EACH ROW
   WHEN NEW.parent_node_id IS NOT NULL
   BEGIN
     UPDATE chat_nodes
       SET depth = (SELECT depth FROM chat_nodes WHERE id = NEW.parent_node_id) + 1
       WHERE id = NEW.id;
     UPDATE chat_nodes
       SET children_count = children_count + 1
       WHERE id = NEW.parent_node_id;
   END`,

  `CREATE TABLE IF NOT EXISTS chat_node_parts (
     id                TEXT PRIMARY KEY,
     chat_node_id      TEXT NOT NULL REFERENCES chat_nodes(id) ON DELETE CASCADE,
     type              TEXT NOT NULL,
     idx               INTEGER NOT NULL,
     content           TEXT NOT NULL,
     content_url       TEXT,
     subtype           TEXT,
     tool_call         TEXT,
     book_entity_ids   TEXT NOT NULL DEFAULT '[]',
     created_at        TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS chat_node_parts_node_id_order_idx
     ON chat_node_parts(chat_node_id, idx)`
];

export async function ensureSchema(db: {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}): Promise<void> {
  for (const stmt of SCHEMA) {
    await db.query(stmt);
  }
}

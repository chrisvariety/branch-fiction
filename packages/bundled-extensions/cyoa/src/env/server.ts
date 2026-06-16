// Stub: chat extension only ever runs against SQLite (the extension-host's local DB).
// Fiction-native's models check env.DATABASE_DIALECT to switch SQL dialects;
// for chat that branch is always 'sqlite'.
export const env = { DATABASE_DIALECT: 'sqlite' as const };

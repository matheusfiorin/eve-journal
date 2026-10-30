CREATE TABLE IF NOT EXISTS pilots (
  character_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  credentials TEXT NOT NULL,
  snapshot TEXT NOT NULL DEFAULT '{}',
  share_training INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  sync_lock_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  character_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

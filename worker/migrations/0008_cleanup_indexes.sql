-- The daily cleanup (worker/index.js cleanup) and Delete my data look rows up by these columns.
CREATE INDEX IF NOT EXISTS oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS sessions_character ON sessions(character_id);
CREATE INDEX IF NOT EXISTS journal_owner ON journal(owner);
CREATE INDEX IF NOT EXISTS journal_tombstones ON journal(updated_at) WHERE data IS NULL;

-- FCM device tokens of the Android app (POST /api/push/register), so the wing room can push a timer or a ping to the wingmate's
-- phone while the app is closed. A token belongs to one pilot; Delete my data and Disconnect remove theirs.
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  character_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_tokens_pilot ON push_tokens(character_id, updated_at);

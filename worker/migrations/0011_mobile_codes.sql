-- One-time codes for the Android app's sign-in (worker/index.js, /api/mobile/redeem). The EVE callback stores a code's hash
-- with the app's PKCE challenge and the new session (encrypted), then hands only the code to the app. Redeeming deletes the
-- row, so a code works once; the daily cleanup removes the ones nobody redeemed.
CREATE TABLE IF NOT EXISTS mobile_codes (
  code_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  character_id INTEGER NOT NULL,
  session_token_encrypted TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mobile_codes_expires ON mobile_codes(expires_at);

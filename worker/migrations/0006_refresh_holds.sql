-- Why the Worker stops asking EVE for a fresh access token. grant_revoked_at: EVE answered invalid_grant, so the
-- refresh token is dead until the pilot reconnects. refresh_after: EVE answered 429; wait until its Retry-After.
-- The OAuth callback clears both.
ALTER TABLE pilots ADD COLUMN grant_revoked_at INTEGER;
ALTER TABLE pilots ADD COLUMN refresh_after INTEGER NOT NULL DEFAULT 0;

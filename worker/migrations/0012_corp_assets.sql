-- Corporation data and the asset browser for the Android app.
-- A pilot's corporation, read from ESI's public character route by the sync (at most every 6 hours); /api/corp serves only the
-- snapshot of the caller's own corporation_id, so membership is whatever ESI says it is.
ALTER TABLE pilots ADD COLUMN corporation_id INTEGER;
ALTER TABLE pilots ADD COLUMN corp_checked_at INTEGER NOT NULL DEFAULT 0;
-- One snapshot per corporation, built by the cron with a connected member's token (source_pilot). snapshot holds each section
-- (starbases, structures, wallets, members, jobs, customs offices, asset summary) with its own error ("needs role Director");
-- error is set only when the whole run failed. A run that ran out of subrequests is partial and continues from where it stopped.
CREATE TABLE IF NOT EXISTS corp_snapshots (
  corporation_id INTEGER PRIMARY KEY,
  snapshot TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  source_pilot INTEGER,
  error TEXT
);
-- The caller's own assets as ESI gave them, kept 10 minutes so browsing does not ask ESI again. expires_at follows ESI's Expires
-- (never earlier than the 10 minutes' cache the app asks for, never later than ESI allows).
CREATE TABLE IF NOT EXISTS asset_cache (
  character_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Journal kind 'pref': a pilot's own settings (systems marked scanned, the haul plan), one row per pilot per setting
-- with id '<name>:<characterId>'. SQLite can't change a CHECK constraint, so the table is rebuilt with the wider one
-- and every row (revs included, which devices' cursors depend on) copied across.
CREATE TABLE journal_next (
  kind TEXT NOT NULL CHECK (kind IN ('goal','entry','pref')),
  id TEXT NOT NULL,
  owner INTEGER NOT NULL,
  data TEXT,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
INSERT INTO journal_next (kind, id, owner, data, rev, updated_at, updated_by) SELECT kind, id, owner, data, rev, updated_at, updated_by FROM journal;
DROP TABLE journal;
ALTER TABLE journal_next RENAME TO journal;
CREATE INDEX IF NOT EXISTS journal_rev ON journal(rev);

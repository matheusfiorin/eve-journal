-- Goals and Logbook entries a browser chose to sync. Goals belong to the wing (owner 0); an entry belongs to the
-- pilot whose session wrote it. rev is one counter for the whole table: a device asks for rows after the last rev it
-- saw. A deleted record keeps its row with data NULL (a tombstone) so other devices learn about the delete.
-- Rows are not tied to the pilots table, so Disconnect leaves the journal in place.
CREATE TABLE IF NOT EXISTS journal (
  kind TEXT NOT NULL CHECK (kind IN ('goal','entry')),
  id TEXT NOT NULL,
  owner INTEGER NOT NULL,
  data TEXT,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS journal_rev ON journal(rev);

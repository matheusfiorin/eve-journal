CREATE TABLE IF NOT EXISTS market_snapshots (
  region_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

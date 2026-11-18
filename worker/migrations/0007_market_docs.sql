-- Market documents the Worker keeps beside the pipeline's region rows (market_snapshots).
-- 'universe': the static meta that only changes with CCP's static data (ores, combat types, skill IDs). Served with
--   region 1 (the gate map) as one versioned, long-cached document; version changes only when its content does.
-- 'activity': last hour's kills and jumps and their decayed 24 h / 7 day history, sampled hourly by the cron.
-- hints holds the Worker's own bookkeeping (ESI ETags, content hashes), never served. turns counts cron runs spent
-- sampling, so the pilot whose sync turn a sample took goes next.
CREATE TABLE IF NOT EXISTS market_docs (
  name TEXT PRIMARY KEY,
  version TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  hints TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0
);
-- Move the pipeline's copies out of its meta row (region 0) so no history is lost at the switch: the kill and jump
-- history becomes the cron's starting point, and the static parts become the first universe version.
-- json_patch onto '{}' drops the parts that row did not have (merge-patch nulls).
INSERT INTO market_docs (name, data, updated_at)
  SELECT 'activity', json_patch('{}', json_object('risk', json(json_extract(data, '$.risk')), 'traffic', json(json_extract(data, '$.traffic')), 'activity', json(json_extract(data, '$.activity')))), updated_at
  FROM market_snapshots WHERE region_id = 0 AND json_extract(data, '$.risk.at') IS NOT NULL
  ON CONFLICT(name) DO NOTHING;
INSERT INTO market_docs (name, version, data, updated_at)
  SELECT 'universe', printf('m%x', MAX(m.updated_at, COALESCE(u.updated_at, 0))),
    json_patch('{}', json_object('ores', json(json_extract(m.data, '$.ores')), 'combat', json(json_extract(m.data, '$.combat')), 'skills', json(json_extract(m.data, '$.skills')))),
    MAX(m.updated_at, COALESCE(u.updated_at, 0))
  FROM market_snapshots m LEFT JOIN market_snapshots u ON u.region_id = 1 WHERE m.region_id = 0
  ON CONFLICT(name) DO NOTHING;
-- Deliberately NOT stripped from region 0 here: deploy applies migrations before `wrangler deploy`, so the previous Worker
-- would still serve /api/market with those keys missing. (0007 was never deployed, so this file was edited, not superseded.)
-- The new Worker drops the keys when the pipeline next writes region 0, and a leftover copy is harmless: joinObjects puts
-- the activity/universe documents last, and pipelineHistory adopts only data newer than the cron's own.
-- ESI answered a pilot's sync with 429 or 420: no ESI request for that pilot until this time (Retry-After).
ALTER TABLE pilots ADD COLUMN esi_after INTEGER NOT NULL DEFAULT 0;

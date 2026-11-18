-- Discord alerts already sent (worker/alerts.js). key names one event (for example job:<pilot>:<job>), so a message
-- goes out once; the daily cleanup removes keys older than 30 days.
CREATE TABLE IF NOT EXISTS alerts (
  key TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_sent ON alerts(sent_at);

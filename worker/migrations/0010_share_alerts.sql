-- Explicit consent for the Discord channel (worker/alerts.js): a pilot's alerts are posted only when they ticked the box
-- on the consent page. Existing pilots never agreed to it, so every row starts at 0 and reconnecting is how to opt in.
ALTER TABLE pilots ADD COLUMN share_alerts INTEGER NOT NULL DEFAULT 0;

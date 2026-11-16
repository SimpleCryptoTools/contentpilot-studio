-- Authentication rate-limit counters. Values stored in rate_key are
-- one-way hashes of the action plus client IP/email; raw identifiers are not stored.
-- This table was previously created lazily by request handlers. IF NOT EXISTS
-- keeps this migration safe for databases where that older code already ran.

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window_started_at
  ON auth_rate_limits (window_started_at);

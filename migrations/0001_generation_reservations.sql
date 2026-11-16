-- Durable generation reservation lifecycle.
-- Apply this migration to the existing contentpilot-db before deploying the
-- Worker version that calls reserveGeneration/completeGeneration/refundGeneration.

CREATE TABLE IF NOT EXISTS generation_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reservation_type TEXT NOT NULL
    CHECK (reservation_type IN ('free', 'credit')),
  usage_date TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('reserved', 'consumed', 'refunded')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_generation_reservations_user_status
  ON generation_reservations (user_id, status);

CREATE INDEX IF NOT EXISTS idx_generation_reservations_created_at
  ON generation_reservations (created_at);

-- Active-session registry. The MelodyRoom DO upserts a snapshot here on every
-- mutation so the admin "Live Game" view can list games in progress without a
-- per-session connection. Rows are advisory only: a DO can be evicted without
-- notice, so freshness is judged by `updated_at`, not by row existence.

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  phase          TEXT NOT NULL,
  selected_genre TEXT,
  rounds_played  INTEGER NOT NULL DEFAULT 0,
  team_count     INTEGER NOT NULL DEFAULT 0,
  teams_json     TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

CREATE TABLE genres (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  emoji      TEXT,
  sort_order INTEGER NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0
);

-- D1 does not enforce foreign keys at runtime; the REFERENCES clause is documentation.
-- Genre deletion is gated at the admin handler layer (checks track count = 0).
CREATE TABLE tracks (
  id           TEXT PRIMARY KEY,
  genre_slug   TEXT NOT NULL REFERENCES genres(slug),
  artist       TEXT NOT NULL,
  title        TEXT NOT NULL,
  year         INTEGER NOT NULL,
  itunes_id    INTEGER UNIQUE,
  source_url   TEXT,
  preview_url  TEXT NOT NULL,
  r2_key       TEXT,
  duration_ms  INTEGER,
  artwork_url  TEXT,
  added_at     INTEGER NOT NULL
);

CREATE INDEX        idx_tracks_genre  ON tracks(genre_slug);
CREATE UNIQUE INDEX idx_tracks_dedupe ON tracks(artist, title, year);

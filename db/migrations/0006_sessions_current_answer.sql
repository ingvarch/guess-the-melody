-- Host-private "current answer" for the admin Live Game view. The DO writes the
-- current (possibly still-unrevealed) track's artist/title/year here so the host
-- can judge guesses from the basic-auth-gated admin without leaking the answer to
-- the public /display. Stored as JSON ({"artist","title","year"}) or NULL when no
-- round is in progress. Never enters the broadcast RoomState.

ALTER TABLE sessions ADD COLUMN current_answer TEXT;
